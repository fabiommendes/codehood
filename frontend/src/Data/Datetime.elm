module Data.Datetime exposing (..)

{-| Decoders and encoders for datetime types
-}

import Date exposing (Date)
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Time exposing (Posix)


{-| Decode Date objects
-}
dateDecoder : D.Decoder Date
dateDecoder =
    D.string
        |> D.andThen
            (\raw ->
                case Date.fromIsoString raw of
                    Ok date ->
                        D.succeed date

                    Err _ ->
                        D.fail ("Invalid date format: " ++ raw)
            )


{-| Decode from a Posix time.

It is represented as an integral number of milliseconds since the Unix epoch 1970-01-01T00:00:00Z.

-}
posixDecoder : D.Decoder Posix
posixDecoder =
    D.float |> D.map ((*) 1000 >> floor >> Time.millisToPosix)


{-| Decode from a Posix time.

It is represented as an integral number of milliseconds since the Unix epoch 1970-01-01T00:00:00Z.

-}
encodePosix : Posix -> E.Value
encodePosix =
    Time.posixToMillis >> toFloat >> (*) 0.001 >> E.float


dueDate : Maybe Posix -> String
dueDate date =
    case date of
        Just posix ->
            posix
                |> Date.fromPosix Time.utc
                |> Date.format "MMMM dd, yyyy"

        Nothing ->
            "Never"
