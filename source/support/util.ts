/**
 * @license Use of this source code is governed by an MIT-style license that
 * can be found in the LICENSE file at https://github.com/cartant/rxjs-tslint-rules
 */

import * as ts from "typescript";
import * as tsutils from "tsutils";

export function couldBeType(type: ts.Type, name: string | RegExp): boolean {

    if (isReferenceType(type)) {
        type = type.target;
    }

    if (isType(type, name)) {
        return true;
    }

    if (isUnionType(type)) {
        return type.types.some((t) => couldBeType(t, name));
    }

    const baseTypes = type.getBaseTypes();
    return Boolean(baseTypes) && baseTypes.some((t) => couldBeType(t, name));
}

export function isConstDeclaration(declaration: ts.Declaration): boolean {

    if (tsutils.isVariableDeclaration(declaration)) {
        if (tsutils.isVariableDeclarationList(declaration.parent)) {
            return tsutils.getVariableDeclarationKind(declaration.parent) === tsutils.VariableDeclarationKind.Const;
        }
    } else if (tsutils.isBindingElement(declaration)) {
        let parent: ts.Node = declaration.parent;
        while (tsutils.isBindingPattern(parent) || tsutils.isVariableDeclaration(parent)) {
            parent = parent.parent;
        }
        if (tsutils.isVariableDeclarationList(parent)) {
            return tsutils.getVariableDeclarationKind(parent) === tsutils.VariableDeclarationKind.Const;
        }
    }
    return false;
}

export function isReferenceType(type: ts.Type): type is ts.TypeReference {

    return tsutils.isTypeFlagSet(type, ts.TypeFlags.Object) &&
        tsutils.isObjectFlagSet(type as ts.ObjectType, ts.ObjectFlags.Reference);
}

export function isThis(node: ts.Node): boolean {

    return node.kind === ts.SyntaxKind.ThisKeyword;
}

export function isType(type: ts.Type, name: string | RegExp): boolean {

    if (!type.symbol) {
        return false;
    }
    return (typeof name === "string") ?
        (type.symbol.name === name) :
        Boolean(type.symbol.name.match(name));
}

export function isUnionType(type: ts.Type): type is ts.UnionType {

    return tsutils.isTypeFlagSet(type, ts.TypeFlags.Union);
}

export function isWithinCallExpressionExpression(node: ts.Node): boolean {

    let parent = node.parent;
    while (parent && tsutils.isPropertyAccessExpression(parent)) {
        node = parent;
        parent = node.parent;
    }
    return parent && tsutils.isCallExpression(parent) && (node === parent.expression);
}
