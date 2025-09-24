module Api exposing
    ( Error, FieldError
    , Paginated, Request, config, expectPaginated, httpHeaders, paginated
    )

{-| Basic API types and functionalities


# Types

@docs Error, FieldError


# Conversion

@docs fromHttpError, httpMethodToString


# URL concatenation

@docs baseUrl, url

-}

import Api.Error exposing (..)
import Http
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Request exposing (HttpMethod(..))
import Result.Extra as Result
import Shared.Model as Shared


type alias Request a =
    Request.Request String a


type alias Error =
    Api.Error.Error


type alias FieldError =
    Api.Error.FieldError


config : Shared.Model -> Request.Config String Error a
config shared =
    { toUrl = \url -> shared.baseApiUrl ++ url
    , headers = httpHeaders shared
    , fromHttpResponse = fromHttpResponse
    , risky = True
    , timeout = Just 10000
    }


type alias Paginated a =
    { count : Int
    , items : List a
    }


paginated : D.Decoder a -> D.Decoder (Paginated a)
paginated itemDecoder =
    D.succeed Paginated
        |> D.required "count" D.int
        |> D.required "items" (D.list itemDecoder)


expectPaginated : D.Decoder a -> Request.Expect (Paginated a)
expectPaginated =
    paginated >> Request.expectJson


{-| Convert error from Http.Error
-}
fromHttpResponse : Request.Expect a -> Http.Response String -> Error
fromHttpResponse expect error =
    case ( error, expect ) of
        ( Http.BadUrl_ url, _ ) ->
            { message = "Invalid URL: " ++ url
            , code = BadUrl
            , error = "bad-url"
            , content = E.object [ ( "url", E.string url ) ]
            , fields = []
            }

        ( Http.Timeout_, _ ) ->
            { message = "Request timed out, please try again later"
            , code = Timeout
            , error = "timeout"
            , content = E.null
            , fields = []
            }

        ( Http.NetworkError_, _ ) ->
            { message = "Could not connect to the server, please check your internet connection"
            , code = NetworkError
            , error = "network-error"
            , content = E.null
            , fields = []
            }

        ( Http.BadStatus_ meta body, _ ) ->
            parseBadResponse meta body

        ( Http.GoodStatus_ _ body, Request.ExpectJson decoder ) ->
            let
                err =
                    { message = "Invalid json data"
                    , code = InvalidPayload
                    , error = "invalid-payload"
                    , content = E.null
                    , fields = []
                    }
            in
            case D.decodeString D.value body of
                Ok json ->
                    case D.decodeValue decoder json of
                        Ok _ ->
                            { err
                                | message = "Unknown error"
                                , content = E.object [ ( "decoded", json ) ]
                            }

                        Err decodeError ->
                            { err
                                | message = "Malformed JSON: " ++ D.errorToString decodeError
                                , content = E.object [ ( "decoded", json ) ]
                            }

                Err _ ->
                    { err
                        | message = "Input is not JSON"
                        , content = E.object [ ( "raw", E.string body ) ]
                    }

        ( Http.GoodStatus_ _ body, _ ) ->
            { message = "Could not process the response data"
            , code = InvalidPayload
            , error = "invalid-payload"
            , content =
                D.decodeString D.value body
                    |> Result.unpack
                        (\_ -> E.object [ ( "raw", E.string body ) ])
                        identity
            , fields = []
            }


httpHeaders : Shared.Model -> List ( String, String )
httpHeaders shared =
    case shared.credentials of
        Just { token } ->
            [ ( "Authorization", "Bearer " ++ token ) ]

        _ ->
            []


parseBadResponse : Http.Metadata -> String -> Error
parseBadResponse meta body =
    case D.decodeString D.value body of
        Ok value ->
            case parseBadResponseBody value of
                Just data ->
                    data

                Nothing ->
                    { message = meta.statusText
                    , code = HttpError meta.statusCode
                    , error =
                        meta.statusText
                            |> String.toLower
                            |> String.replace " " "-"
                    , content = E.object [ ( "error", value ) ]
                    , fields = []
                    }

        Err _ ->
            { message = meta.statusText
            , code = HttpError meta.statusCode
            , error =
                meta.statusText
                    |> String.toLower
                    |> String.replace " " "-"
            , content = E.object [ ( "raw", E.string body ) ]
            , fields = []
            }


parseBadResponseBody : E.Value -> Maybe Error
parseBadResponseBody value =
    case D.decodeValue decoder value of
        Ok data ->
            Just data

        Err _ ->
            Nothing
