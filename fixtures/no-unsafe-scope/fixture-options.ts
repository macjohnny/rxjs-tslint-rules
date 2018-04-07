import { Observable } from "rxjs";
import { of } from "rxjs/observable/of";
import { map } from "rxjs/operators/map";
import { tap } from "rxjs/operators/tap";
import "rxjs/add/observable/of";
import "rxjs/add/operator/do";
import "rxjs/add/operator/map";

let outer: any;
Observable.of(1).do(value => outer = value).subscribe();
of(1).pipe(tap(value => outer = value)).subscribe();

function patched(outer: number): Observable<number> {
    return Observable.of(1).map(value => outer + value);
}

function piped(outer: number): Observable<number> {
    return of(1).pipe(map(value => outer + value));
}
