module Elements.Home exposing (Model, Msg(..), init, update, view)

{-| An empty template element
-}

import Auth
import Data.Classroom exposing (Classroom)
import Html as H exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (onInput, onSubmit)
import Ui.Cards as Cards exposing (classrooms)
import Util exposing (..)


type alias Model =
    { classrooms : Maybe (List Classroom)
    , registrationId : String
    , error : String
    }


type Msg
    = ClassroomsReceived (List Classroom)
    | RegistrationReceived (Result String Classroom)
    | UpdateRegistrationId String
    | SendRegistrationCode String


init : Auth.User -> Maybe (List Classroom) -> Model
init _ classrooms =
    { classrooms = classrooms
    , registrationId = ""
    , error = ""
    }


update : Msg -> Model -> Model
update msg model =
    case msg of
        ClassroomsReceived cls ->
            { model | classrooms = Just cls }

        UpdateRegistrationId id ->
            { model | registrationId = id }

        SendRegistrationCode _ ->
            model

        RegistrationReceived (Ok cls) ->
            { model
                | classrooms = Just (cls :: (model.classrooms |> Maybe.withDefault []))
                , registrationId = ""
                , error = ""
            }

        RegistrationReceived (Err err) ->
            { model | error = err }


view : Model -> Html Msg
view m =
    div []
        [ Cards.classrooms m.classrooms
        , viewNewClassroom m
        ]


viewNewClassroom : Model -> Html Msg
viewNewClassroom m =
    H.form [ id "new-classroom", class "p-4 shadow-md bg-base-300", onSubmit (SendRegistrationCode m.registrationId) ]
        [ fieldset [ class "fieldset" ]
            [ legend [ class "fieldset-legend" ] [ text "Enrollment code" ]
            , input
                [ type_ "text"
                , class "input w-full"
                , onInput UpdateRegistrationId
                , placeholder "Code"
                , name "class-id"
                , maxlength 8
                ]
                []
            , p [ class "label" ] [ text "Ask the enrollment code to the classroom instructor." ]
            ]
        , div [ class "text-right" ] [ button [ class "btn btn-primary" ] [ text "Register" ] ]
        ]
