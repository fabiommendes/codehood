module Api.Task exposing (HttpTask, andThen, fail, fromRequest, map, map2, map3, map4, map5, mapError, onError, succeed, toTask)

import Api exposing (Error, Request, config)
import Request
import Shared.Model as Shared
import Task exposing (Task)


type HttpTask a
    = Task (Shared.Model -> Task.Task Error a)


unwrap : Shared.Model -> HttpTask a -> Task.Task Error a
unwrap shared (Task inner) =
    inner shared


toTask : HttpTask a -> Shared.Model -> Task.Task Error a
toTask task model =
    unwrap model task


fromRequest : Request a -> HttpTask a
fromRequest request =
    Task (\shared -> Request.task (config shared) request)


andThen : (a -> HttpTask b) -> HttpTask a -> HttpTask b
andThen fn (Task inner) =
    Task
        (\shared ->
            inner shared
                |> Task.andThen (fn >> unwrap shared)
        )


succeed : a -> HttpTask a
succeed value =
    Task (\_ -> Task.succeed value)


fail : Error -> HttpTask a
fail error =
    Task (\_ -> Task.fail error)


map : (a -> b) -> HttpTask a -> HttpTask b
map fn (Task inner) =
    Task
        (\shared ->
            inner shared
                |> Task.map fn
        )


map2 : (a -> b -> c) -> HttpTask a -> HttpTask b -> HttpTask c
map2 fn (Task innerA) (Task innerB) =
    Task
        (\shared ->
            Task.map2 fn (innerA shared) (innerB shared)
        )


map3 : (a -> b -> c -> d) -> HttpTask a -> HttpTask b -> HttpTask c -> HttpTask d
map3 fn (Task innerA) (Task innerB) (Task innerC) =
    Task
        (\shared ->
            Task.map3 fn (innerA shared) (innerB shared) (innerC shared)
        )


map4 : (a -> b -> c -> d -> e) -> HttpTask a -> HttpTask b -> HttpTask c -> HttpTask d -> HttpTask e
map4 fn (Task innerA) (Task innerB) (Task innerC) (Task innerD) =
    Task
        (\shared ->
            Task.map4 fn (innerA shared) (innerB shared) (innerC shared) (innerD shared)
        )


map5 : (a -> b -> c -> d -> e -> f) -> HttpTask a -> HttpTask b -> HttpTask c -> HttpTask d -> HttpTask e -> HttpTask f
map5 fn (Task innerA) (Task innerB) (Task innerC) (Task innerD) (Task innerE) =
    Task
        (\shared ->
            Task.map5 fn (innerA shared) (innerB shared) (innerC shared) (innerD shared) (innerE shared)
        )


mapError : (Error -> Error) -> HttpTask a -> HttpTask a
mapError fn (Task inner) =
    Task
        (\shared ->
            inner shared
                |> Task.mapError fn
        )


onError : (Error -> HttpTask a) -> HttpTask a -> HttpTask a
onError fn (Task inner) =
    Task
        (\shared ->
            inner shared
                |> Task.onError (fn >> unwrap shared)
        )
