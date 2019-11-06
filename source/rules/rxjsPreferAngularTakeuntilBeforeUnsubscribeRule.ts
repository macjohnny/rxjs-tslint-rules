/**
 * @license Use of this source code is governed by an MIT-style license that
 * can be found in the LICENSE file at https://github.com/cartant/rxjs-tslint-rules
 */
/*tslint:disable:no-use-before-declare*/

import * as Lint from "tslint";
import * as tsutils from "tsutils";
import * as ts from "typescript";
import { couldBeType } from "../support/util";
import { tsquery } from "@phenomnomnominal/tsquery";
import { dedent } from "tslint/lib/utils";

export class Rule extends Lint.Rules.TypedRule {
  public static metadata: Lint.IRuleMetadata = {
    description: dedent`Enforces the application of the takeUntil operator
                        when calling of subscribe within an Angular component.`,
    options: {
      properties: {
        allowedDestroySubjectNames: { type: "array", items: { type: "string" } }
      },
      type: "object"
    },
    optionsDescription: Lint.Utils.dedent`
      An optional object with optional \`destroySubjectNames\` property.
      The property is an array containing the allowed subject names expected as argument of \`takeUntil\`, defaults to ['destroy$', '_destroy$', 'destroyed$', '_destroyed$'].`,
    requiresTypeInfo: true,
    ruleName: "rxjs-prefer-angular-takeuntil-before-unsubscribe",
    type: "functionality",
    typescriptOnly: true
  };

  public static FAILURE_STRING =
    "subscribe within a component must be preceded by takeUntil";

  public static FAILURE_STRING_SUBJECT_NAME =
    "takeUntil argument must be one of {allowedDestroySubjectNames}";

  public static FAILURE_STRING_NG_ON_DESTROY =
    "component containing subscribe must implement the ngOnDestroy() method";

  public static FAILURE_STRING_NG_ON_DESTROY_SUBJECT_METHOD_NOT_CALLED =
    "there must be an invocation of {destroySubjectName}.{methodName}() in ngOnDestroy()";

  private allowedDestroySubjectNames: string[] = ["destroy$", "_destroy$"];

  public applyWithProgram(
    sourceFile: ts.SourceFile,
    program: ts.Program
  ): Lint.RuleFailure[] {
    const failures: Lint.RuleFailure[] = [];

    // initialize the options
    const options = this.getOptions();
    if (options.ruleArguments) {
      const allowedDestroySubjectNamesOption = options.ruleArguments.find(
        ruleArgument =>
          ruleArgument.hasOwnProperty("allowedDestroySubjectNames")
      );
      if (
        allowedDestroySubjectNamesOption &&
        Array.isArray(
          allowedDestroySubjectNamesOption["allowedDestroySubjectNames"]
        )
      ) {
        this.allowedDestroySubjectNames =
          allowedDestroySubjectNamesOption["allowedDestroySubjectNames"];
      }
    }

    // find all classes with an @Component() decorator
    const componentClassDeclarations = tsquery(
      sourceFile,
      `ClassDeclaration:has(Decorator[expression.expression.name='Component'])`
    );
    componentClassDeclarations.forEach(componentClassDeclaration => {
      failures.push(
        ...this.checkComponentClassDeclaration(
          sourceFile,
          program,
          componentClassDeclaration as ts.ClassDeclaration
        )
      );
    });

    return failures;
  }

  /**
   * Checks a component class for occurrences of .subscribe() and corresponding takeUntil() requirements
   */
  private checkComponentClassDeclaration(
    sourceFile: ts.SourceFile,
    program: ts.Program,
    componentClassDeclaration: ts.ClassDeclaration
  ): Lint.RuleFailure[] {
    const failures: Lint.RuleFailure[] = [];

    const typeChecker = program.getTypeChecker();
    /** whether there is at least one observable.subscribe() expression */
    let hasSubscribeInComponent = false;
    /** list of destroy subjects used in takeUntil() operators */
    const destroySubjectNamesUsed: string[] = [];

    // find observable.subscribe() call expressions
    const propertyAccessExpressions = tsquery(
      componentClassDeclaration,
      `CallExpression > PropertyAccessExpression[name.name="subscribe"]`
    );

    // check whether it is an observable and check the takeUntil before the subscribe
    propertyAccessExpressions.forEach(node => {
      const propertyAccessExpression = node as ts.PropertyAccessExpression;
      const type = typeChecker.getTypeAtLocation(
        propertyAccessExpression.expression
      );
      if (couldBeType(type, "Observable")) {
        const subscribeFailures = this.ensureTakeuntilBeforeSubscribe(
          sourceFile,
          propertyAccessExpression
        );
        failures.push(...subscribeFailures.failures);
        if (
          subscribeFailures.destroySubjectName &&
          !destroySubjectNamesUsed.includes(
            subscribeFailures.destroySubjectName
          )
        ) {
          destroySubjectNamesUsed.push(subscribeFailures.destroySubjectName);
        }
        hasSubscribeInComponent = true;
      }
    });

    // check the ngOnDestroyMethod
    if (hasSubscribeInComponent) {
      const ngOnDestroyFailures = this.checkNgOnDestroy(
        sourceFile,
        componentClassDeclaration as ts.ClassDeclaration,
        destroySubjectNamesUsed
      );
      failures.push(...ngOnDestroyFailures);
    }

    return failures;
  }

  /**
   * Checks whether a .subscribe() is preceded by a .pipe(<...>, takeUntil(<...>))
   */
  private ensureTakeuntilBeforeSubscribe(
    sourceFile: ts.SourceFile,
    node: ts.PropertyAccessExpression
  ): { failures: Lint.RuleFailure[]; destroySubjectName: string } {
    const failures: Lint.RuleFailure[] = [];
    const subscribeContext = node.expression;

    /** Whether a takeUntil() operator preceding the .subscribe() was found */
    let lastTakeUntilFound = false;
    /** name of the takeUntil() argument */
    let destroySubjectName: string;

    // check whether subscribeContext.expression is <something>.pipe()
    if (
      tsutils.isCallExpression(subscribeContext) &&
      tsutils.isPropertyAccessExpression(subscribeContext.expression) &&
      subscribeContext.expression.name.getText() === "pipe"
    ) {
      const pipedOperators = subscribeContext.arguments;
      if (pipedOperators.length > 0) {
        const lastPipedOperator = pipedOperators[pipedOperators.length - 1];
        // check whether the last operator in the .pipe() call is takeUntil()
        if (
          tsutils.isCallExpression(lastPipedOperator) &&
          tsutils.isIdentifier(lastPipedOperator.expression) &&
          lastPipedOperator.expression.text === "takeUntil"
        ) {
          lastTakeUntilFound = true;
          // check the argument of takeUntil()
          const destroySubjectNameCheck = this.checkDestroySubjectName(
            sourceFile,
            lastPipedOperator
          );
          failures.push(...destroySubjectNameCheck.failures);
          destroySubjectName = destroySubjectNameCheck.destroySubjectName;
        }
      }
    }

    // add failure if there is no takeUntil() in the last position of a .pipe()
    if (!lastTakeUntilFound) {
      failures.push(
        new Lint.RuleFailure(
          sourceFile,
          node.name.getStart(),
          node.name.getStart() + node.name.getWidth(),
          Rule.FAILURE_STRING,
          this.ruleName
        )
      );
    }

    return { failures, destroySubjectName: destroySubjectName };
  }

  /**
   * Checks whether the argument of the given takeUntil(this.destroy$) expression
   * is among the list of allowedDestroySubjectNames
   */
  private checkDestroySubjectName(
    sourceFile: ts.SourceFile,
    takeUntilOperator: ts.CallExpression
  ): { failures: Lint.RuleFailure[]; destroySubjectName: string } {
    const failures: Lint.RuleFailure[] = [];

    /** name of the takeUntil() argument */
    let destroySubjectName: string;

    /** whether the takeUntil() argument is among the allowed names */
    let isAllowedDestroySubject = false;

    let takeUntilOperatorArgument: ts.PropertyAccessExpression;
    let highlightedNode: ts.Expression = takeUntilOperator;

    // check the takeUntil() argument
    if (
      takeUntilOperator.arguments.length >= 1 &&
      takeUntilOperator.arguments[0]
    ) {
      highlightedNode = takeUntilOperator.arguments[0];
      if (tsutils.isPropertyAccessExpression(takeUntilOperator.arguments[0])) {
        takeUntilOperatorArgument = takeUntilOperator
          .arguments[0] as ts.PropertyAccessExpression;
        destroySubjectName = takeUntilOperatorArgument.name.getText();

        isAllowedDestroySubject = this.allowedDestroySubjectNames.some(
          allowedDestroySubjectName =>
            takeUntilOperatorArgument.name.getText() ===
            allowedDestroySubjectName
        );
      }
    }

    if (!isAllowedDestroySubject) {
      failures.push(
        new Lint.RuleFailure(
          sourceFile,
          highlightedNode.getStart(),
          highlightedNode.getStart() + highlightedNode.getWidth(),
          Rule.FAILURE_STRING_SUBJECT_NAME.replace(
            "{allowedDestroySubjectNames}",
            "[" +
              this.allowedDestroySubjectNames
                .map(name => "this." + name)
                .join(", ") +
              "]"
          ),
          this.ruleName
        )
      );
    }

    return { failures, destroySubjectName };
  }

  /**
   * Checks whether the class implements an ngOnDestroy method and invokes .next() and .complete() on the destroy subjects
   */
  private checkNgOnDestroy(
    sourceFile: ts.SourceFile,
    classDeclaration: ts.ClassDeclaration,
    destroySubjectNamesUsed: string[]
  ): Lint.RuleFailure[] {
    const failures: Lint.RuleFailure[] = [];
    const ngOnDestroyMethod = classDeclaration.members.find(
      member => member.name.getText() === "ngOnDestroy"
    );

    // check whether the ngOnDestroy method is implemented
    // and contains invocations of .next() and .complete() on all destroy subjects used
    if (ngOnDestroyMethod) {
      failures.push(
        ...this.checkDestroySubjectMethodInvocation(
          sourceFile,
          ngOnDestroyMethod,
          destroySubjectNamesUsed,
          "next"
        )
      );
      failures.push(
        ...this.checkDestroySubjectMethodInvocation(
          sourceFile,
          ngOnDestroyMethod,
          destroySubjectNamesUsed,
          "complete"
        )
      );
    } else {
      failures.push(
        new Lint.RuleFailure(
          sourceFile,
          classDeclaration.name.getStart(),
          classDeclaration.name.getStart() + classDeclaration.name.getWidth(),
          Rule.FAILURE_STRING_NG_ON_DESTROY,
          this.ruleName
        )
      );
    }
    return failures;
  }

  /**
   * Checks whether all >destroySubjectNameUsed>.<methodName>() are invoked in the ngOnDestroyMethod
   */
  private checkDestroySubjectMethodInvocation(
    sourceFile: ts.SourceFile,
    ngOnDestroyMethod: ts.ClassElement,
    destroySubjectNamesUsed: string[],
    methodName: string
  ) {
    const failures: Lint.RuleFailure[] = [];
    const destroySubjectMethodInvocations = tsquery(
      ngOnDestroyMethod,
      `CallExpression > PropertyAccessExpression[name.name="${methodName}"]`
    ) as ts.PropertyAccessExpression[];
    destroySubjectNamesUsed.forEach(destroySubjectName => {
      // check whether there is one invocation of <destroySubjectName>.<methodName>()
      if (
        !destroySubjectMethodInvocations.some(
          nextInvocation =>
            tsutils.isPropertyAccessExpression(nextInvocation.expression) &&
            nextInvocation.expression.name.getText() === destroySubjectName
        )
      ) {
        failures.push(
          new Lint.RuleFailure(
            sourceFile,
            ngOnDestroyMethod.name.getStart(),
            ngOnDestroyMethod.name.getStart() +
              ngOnDestroyMethod.name.getWidth(),
            Rule.FAILURE_STRING_NG_ON_DESTROY_SUBJECT_METHOD_NOT_CALLED.replace(
              "{destroySubjectName}",
              `this.${destroySubjectName}`
            ).replace("{methodName}", methodName),
            this.ruleName
          )
        );
      }
    });
    return failures;
  }
}