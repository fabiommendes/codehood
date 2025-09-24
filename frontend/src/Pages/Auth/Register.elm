module Pages.Auth.Register exposing (Model, Msg, page)

import Api
import Api.Auth
import Api.Classrooms exposing (getEnrolled)
import Components.Login exposing (Msg(..))
import Data.Credentials exposing (Credentials)
import Data.RegisterUser exposing (RegisterUser)
import Effect exposing (Effect, withEff, withNoEff)
import Elements.Register as Register
import Html as H
import Html.Attributes as HA
import Page exposing (Page)
import Route exposing (Route)
import Route.Path
import Shared
import Shared.Msg
import Util.Lens as L
import View exposing (View)


page : Shared.Model -> Route () -> Page Model Msg
page shared route =
    Page.new
        { init = init
        , update = update
        , subscriptions = subscriptions
        , view = view
        }



-- INIT


type alias Model =
    { register : Register.Model
    , succeed : Bool
    }


init : () -> ( Model, Effect Msg )
init () =
    { register = Register.init ""
    , succeed = False
    }
        |> withNoEff



-- UPDATE


type Msg
    = NoOp
    | RegisterMsg Register.Msg
    | CredentialsReceived (Result Api.Error Credentials)
    | Redirect


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        RegisterMsg (Register.Submit payload) ->
            let
                request =
                    Api.Auth.register payload
            in
            model
                |> withEff (Effect.sendRequest CredentialsReceived request)

        RegisterMsg msg ->
            model
                |> L.map (Register.update msg) L.register
                |> withNoEff

        CredentialsReceived (Ok credentials) ->
            model
                |> withEff
                    (Effect.batch
                        [ Effect.authenticate credentials
                        , Effect.sharedMsg (Shared.Msg.ClassroomReceived (Ok []))
                        , Effect.delayMsg 1 Redirect
                        ]
                    )

        CredentialsReceived (Err err) ->
            case Api.Auth.fieldErrors err of
                Just errors ->
                    model
                        |> withEff (Effect.sendMsg (RegisterMsg (Register.SetErrors errors)))

                _ ->
                    model |> withEff (Effect.apiError err)

        Redirect ->
            model
                |> withEff (Effect.pushRoutePath Route.Path.Home_)

        _ ->
            model
                |> withNoEff



-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.none



-- VIEW


view : Model -> View Msg
view model =
    { title = "Register new user"
    , body =
        [ H.div [ HA.class "w-full mx-auto p-2 min-h-screen textured-background" ] <|
            if model.succeed then
                [ H.text "User registered succesfully. Please ", H.a [ HA.href "/auth/login" ] [ H.text "login." ] ]

            else
                [ H.map RegisterMsg (Register.view model.register) ]
        ]
    }
