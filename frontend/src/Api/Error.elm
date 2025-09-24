module Api.Error exposing (..)

import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E


{-| A more convinent representation of Http errors.
-}
type alias Error =
    { code : ErrorCode
    , error : String
    , message : String
    , content : E.Value
    , fields : List FieldError
    }


decoder : D.Decoder Error
decoder =
    D.succeed Error
        |> D.required "code" (D.field "code" errorCodeDecoder)
        |> D.required "error" (D.field "error" D.string)
        |> D.required "message" (D.field "message" D.string)
        |> D.optional "content" (D.field "content" D.value) E.null
        |> D.optional "fields" (D.field "fields" (D.list fieldErrorDecoder)) []


encode : Error -> E.Value
encode error =
    E.object
        [ ( "code", E.int (errorCodeToInt error.code) )
        , ( "error", E.string error.error )
        , ( "message", E.string error.message )
        , ( "content", error.content )
        , ( "fields", E.list encodeFieldError error.fields )
        ]


toString : Error -> String
toString error =
    String.join "\n    "
        [ "Error "
        , "{ code = " ++ String.fromInt (errorCodeToInt error.code)
        , ", error = " ++ error.error
        , ", message = " ++ error.message
        , ", content = " ++ (E.encode 0 error.content |> String.replace "\"" "")
        , ", fields = " ++ (E.encode 0 (E.list encodeFieldError error.fields) |> String.replace "\"" "")
        , "}"
        ]


type alias FieldError =
    { field : String
    , message : String
    , content : E.Value
    }


fieldErrorDecoder : D.Decoder FieldError
fieldErrorDecoder =
    D.succeed FieldError
        |> D.required "field" (D.field "field" D.string)
        |> D.required "message" (D.field "message" D.string)
        |> D.optional "content" (D.field "message" D.value) E.null


encodeFieldError : FieldError -> E.Value
encodeFieldError error =
    E.object
        [ ( "field", E.string error.field )
        , ( "message", E.string error.message )
        , ( "content", error.content )
        ]


type ErrorCode
    = BadUrl
    | Timeout
    | NetworkError
    | InvalidPayload
    | HttpError Int


errorCodeDecoder : D.Decoder ErrorCode
errorCodeDecoder =
    D.int
        |> D.andThen
            (\code ->
                if code == 1400 then
                    D.succeed BadUrl

                else if code == 1408 then
                    D.succeed Timeout

                else if code == 1503 then
                    D.succeed NetworkError

                else if code == 1200 then
                    D.succeed InvalidPayload

                else
                    D.succeed (HttpError code)
            )


errorCodeToInt : ErrorCode -> Int
errorCodeToInt code =
    case code of
        BadUrl ->
            1400

        Timeout ->
            1408

        NetworkError ->
            1503

        InvalidPayload ->
            1200

        HttpError value ->
            value
