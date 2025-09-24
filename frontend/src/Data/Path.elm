module Data.Path exposing (..)

import Json.Decode as D
import Json.Encode as E
import Route.Path as Path exposing (Path)


encode : Path -> E.Value
encode path =
    E.string (Path.toString path)


decoder : D.Decoder Path
decoder =
    D.string
        |> D.andThen
            (\pathString ->
                case Path.fromString pathString of
                    Just path ->
                        D.succeed path

                    Nothing ->
                        D.fail ("Invalid path: " ++ pathString)
            )
