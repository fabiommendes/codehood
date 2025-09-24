port module Effect.Log exposing (..)

{-| Logging capabilities to the Effects module
-}

import Json.Encode as E


port sendToLogger :
    { level : String
    , title : String
    , data : E.Value
    }
    -> Cmd msg


type LogLevel
    = Debug
    | Info
    | Warning
    | Error


logLevelToString : LogLevel -> String
logLevelToString level =
    case level of
        Debug ->
            "DEBUG"

        Info ->
            "INFO"

        Warning ->
            "WARNING"

        Error ->
            "ERROR"


log : LogLevel -> String -> E.Value -> Cmd msg
log level title data =
    sendToLogger <|
        { level = logLevelToString level
        , title = title
        , data = data
        }
