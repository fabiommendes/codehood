module Pages.Home_ exposing (Model, Msg, page)

import Api
import Api.Classrooms exposing (getEnrolled)
import Components.Home as Home
import Components.LandingPage as LandingPage
import Data.Classroom exposing (Classroom)
import Effect exposing (Effect, withEff, withNoEff)
import Html as H
import Layouts
import Layouts.Main as Layout
import Page exposing (Page)
import Route exposing (Route)
import Shared
import Shared.Msg exposing (Msg(..))
import View exposing (View)


page : Shared.Model -> Route () -> Page Model Msg
page model _ =
    case model.credentials of
        Just credentials ->
            let
                init () =
                    Home (Home.init credentials.user model.classrooms)
                        |> withEff (Effect.sendRequest ClassroomsReceived getEnrolled)
            in
            Page.new
                { init = init
                , update = update
                , subscriptions = \_ -> Sub.none
                , view = view
                }
                |> Page.withLayout (\_ -> Layouts.Main (Layout.props credentials.user))

        _ ->
            Page.new
                { init = \() -> LandingPage LandingPage.init |> withNoEff
                , update = update
                , subscriptions = \_ -> Sub.none
                , view = view
                }


type Model
    = Home Home.Model
    | LandingPage LandingPage.Model


type Msg
    = HomeMsg Home.Msg
    | LandingPageMsg LandingPage.Msg
    | ClassroomsReceived (Result Api.Error (List Classroom))
    | EnrolledToClassroom (Result Api.Error Classroom)


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model_ =
    case ( msg_, model_ ) of
        ( HomeMsg (Home.SendRegistrationCode code), Home model ) ->
            Home model
                |> withEff (Effect.sendRequest EnrolledToClassroom (Api.Classrooms.enroll code))

        ( HomeMsg msg, Home model ) ->
            Home.update msg model
                |> Home
                |> withNoEff

        ( LandingPageMsg msg, LandingPage model ) ->
            LandingPage.update msg model
                |> LandingPage
                |> withNoEff

        ( ClassroomsReceived (Ok classrooms), Home model ) ->
            Home.update (Home.UpdateClassrooms classrooms) model
                |> Home
                |> withNoEff

        ( EnrolledToClassroom (Ok classroom), Home model ) ->
            Home.update (Home.UpdateRegistration (Ok classroom)) model
                |> Home
                |> withNoEff

        ( ClassroomsReceived (Err err), _ ) ->
            model_
                |> withEff (Effect.apiError err)

        _ ->
            model_ |> withNoEff


view : Model -> View Msg
view model_ =
    { title = "Home page"
    , body =
        case model_ of
            LandingPage model ->
                [ LandingPage.view model
                    |> H.map LandingPageMsg
                ]

            Home model ->
                [ Home.view model
                    |> H.map HomeMsg
                ]
    }
