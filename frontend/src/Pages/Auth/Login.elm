module Pages.Auth.Login exposing (Model, Msg, page)

import Api
import Api.Auth
import Api.Classrooms exposing (getEnrolled)
import Components.Login as Login
import Data.Classroom exposing (Classroom)
import Data.Credentials exposing (Credentials)
import Dict
import Effect exposing (Effect, withEff, withNoEff)
import Html as H
import Html.Attributes as HA
import Page exposing (Page)
import Route exposing (Route)
import Route.Path as P
import Shared
import Shared.Msg exposing (Msg(..))
import Util.Lens as L
import View exposing (View)


page : Shared.Model -> Route () -> Page Model Msg
page shared route =
    Page.new
        { init =
            init
                { credentials = shared.credentials
                , redirect =
                    Dict.get "from" route.query |> Maybe.withDefault ""
                }
        , update = update
        , subscriptions = subscriptions
        , view = view
        }


type alias Model =
    { login : Login.Model
    , redirect : String
    }


init : { credentials : Maybe Credentials, redirect : String } -> () -> ( Model, Effect Msg )
init { credentials, redirect } () =
    let
        model =
            { login = Login.init, redirect = redirect }
    in
    case ( credentials, redirect ) of
        ( _, "" ) ->
            model |> withNoEff

        ( Nothing, _ ) ->
            model |> withNoEff

        ( Just _, fromPage ) ->
            model
                |> withEff (Effect.pushUrl fromPage)


type Msg
    = LoginMsg Login.Msg
    | CredentialsReceived (Result Api.Error Credentials)
    | EnrolledClassroomsReceived (Result Api.Error (List Classroom))
    | VerifyEmailReceived (Result Api.Error Credentials)
    | NoOp
    | Redirect


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        LoginMsg (Login.Submit { email, password }) ->
            model
                |> waiting.set True
                |> withEff
                    (Effect.sendRequest CredentialsReceived <|
                        Api.Auth.login
                            { email = email
                            , password = password
                            }
                    )

        LoginMsg (Login.VerifyLogin email) ->
            model
                |> withEff
                    (Effect.sendRequest VerifyEmailReceived <|
                        Api.Auth.login
                            { email = email
                            , password = ""
                            }
                    )

        LoginMsg Login.Register ->
            model |> withEff (Effect.pushRoutePath P.Auth_Register)

        CredentialsReceived (Ok credentials) ->
            let
                request =
                    getEnrolled
            in
            model
                |> withEff
                    (Effect.batch
                        [ Effect.authenticate credentials
                        , Effect.sendRequest EnrolledClassroomsReceived request
                        , Effect.delayMsg 1 Redirect
                        ]
                    )

        EnrolledClassroomsReceived (Ok classrooms) ->
            let
                msg =
                    ClassroomReceived (Ok classrooms)
            in
            model
                |> withEff
                    (Effect.batch
                        [ Effect.sharedMsg msg
                        , Effect.delayMsg 1 Redirect
                        ]
                    )

        CredentialsReceived (Err error) ->
            model
                |> waiting.set False
                |> withEff (Effect.apiError error)

        EnrolledClassroomsReceived (Err error) ->
            model
                |> waiting.set False
                |> withEff (Effect.apiError error)

        -- This should never happen, we use the information in the error message
        -- to determine if the e-mail exists or not
        VerifyEmailReceived (Ok _) ->
            model |> withNoEff

        VerifyEmailReceived (Err error) ->
            case Api.Auth.loginError error of
                Just Api.Auth.InvalidEmail ->
                    model
                        |> L.map (Login.update Login.UserInvalid) L.login
                        |> withNoEff

                -- E-mail exists, proceed
                Just Api.Auth.InvalidPassword ->
                    model
                        |> L.map (Login.update Login.UserVerified) L.login
                        |> withNoEff

                _ ->
                    model
                        |> waiting.set False
                        |> withEff (Effect.apiError error)

        LoginMsg msg ->
            model
                |> L.map (Login.update msg) L.login
                |> withNoEff

        Redirect ->
            let
                url =
                    if model.redirect == "" then
                        "/"

                    else
                        model.redirect
            in
            model
                |> withEff (Effect.pushUrl url)

        NoOp ->
            model
                |> withNoEff


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> View Msg
view model =
    { title = "Sign-in"
    , body =
        [ H.div
            [ HA.class "w-full p-2 min-h-screen flex textured-background" ]
            [ H.map LoginMsg <| Login.view model.login
            ]
        ]
    }



-- COMPOSITE LENSES


waiting : L.Lens { a | login : { b | waiting : c } } c
waiting =
    L.chain L.login L.waiting
