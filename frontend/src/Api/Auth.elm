module Api.Auth exposing (Error(..), fieldErrors, login, loginError, register)

import Api
import Data.Credentials as Credentials exposing (Credentials)
import Data.RegisterUser as RegisterUser exposing (RegisterUser)
import Dict exposing (Dict)
import Json.Decode as D
import Json.Encode as E
import Request
import Util.Lens exposing (password)


type Error
    = InvalidEmail
    | InvalidPassword


{-| Request login
-}
login :
    { email : String
    , password : String
    }
    -> Api.Request Credentials
login { email, password } =
    Request.post
        { url = "/auth/login"
        , expect = Request.expectJson Credentials.decoder
        }
        |> Request.withJsonBody
            (E.object
                [ ( "email", E.string email )
                , ( "password", E.string password )
                ]
            )


{-| Register new user
-}
register : RegisterUser -> Api.Request Credentials
register data =
    Request.post
        { url = "/auth/register"
        , expect = Request.expectJson Credentials.decoder
        }
        |> Request.withJsonBody (RegisterUser.encode data)


{-| Return the error type, InvalidEmail | InvalidPassword
-}
loginError : Api.Error -> Maybe Error
loginError err =
    let
        decoder =
            D.at [ "error", "error" ] D.string
                |> D.andThen
                    (\st ->
                        case st of
                            "invalid-email" ->
                                D.succeed InvalidEmail

                            "invalid-password" ->
                                D.succeed InvalidPassword

                            _ ->
                                D.fail ("invalid case: " ++ st)
                    )
    in
    D.decodeValue decoder err.content
        |> Result.toMaybe


{-| Field errors
-}
fieldErrors : Api.Error -> Maybe (Dict String (List String))
fieldErrors err =
    let
        decoder =
            D.at [ "error", "fields" ] (D.list (D.dict D.string))

        data =
            D.decodeValue decoder err.content
                |> Result.toMaybe

        normalize : Dict String (List String) -> List (Dict String String) -> Dict String (List String)
        normalize acc raw =
            case raw of
                [] ->
                    acc

                head :: tail ->
                    let
                        acc_ =
                            Dict.toList head
                                |> List.foldr reducer acc

                        reducer ( k, v ) d =
                            Dict.update k (add v) d

                        add value lst =
                            case lst of
                                Just xs ->
                                    Just (xs ++ [ value ])

                                _ ->
                                    Just [ value ]
                    in
                    normalize acc_ tail
    in
    data
        |> Maybe.map (normalize Dict.empty)
