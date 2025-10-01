module Components.ExamIndex exposing (Model, Msg(..), init, update, view)

{-| An empty template component
-}

import Data.Classroom as Classroom exposing (Classroom)
import Data.Exam as Data exposing (Exam)
import Date
import Html exposing (..)
import Html.Attributes exposing (..)
import Route.Path as Path
import Time
import Util exposing (..)


type alias Model =
    { data : List Exam
    , classroom : Classroom
    }


type Msg
    = NoOp


init : Model
init =
    { data = []
    , classroom = Classroom.empty
    }


update : Msg -> Model -> Model
update msg model =
    case msg of
        NoOp ->
            model


view : Model -> Html Msg
view model =
    let
        examCard : Classroom -> Exam -> Html msg
        examCard cls exam =
            let
                endTime =
                    exam.end
                        |> Maybe.map (Date.fromPosix Time.utc >> Date.format "dd/MM/yyyy")
                        |> Maybe.withDefault "never"
            in
            li [ class "card bg-base-100 shadow-md p-4 border border-base-300 rounded-lg" ]
                [ div [ class "text-xl font-bold text-primary" ] [ text exam.title ]
                , div [ class "text-secondary" ] [ text ("Due: " ++ endTime) ]
                , a [ Path.href (Data.toPath cls exam), class "btn btn-primary text-accent mt-2" ] [ text "GO" ]
                ]
    in
    case model.data of
        [] ->
            viewWarning "No exam happening right now!"

        exams ->
            div [ class "p-4" ]
                [ h2 [] [ text "Exams happening right now!" ]
                , ul [ class "space-y-4" ]
                    (List.map (examCard model.classroom) exams)
                ]


viewWarning : String -> Html msg
viewWarning message =
    div [ class "alert alert-warning shadow-lg text-lg p-8 m-8" ]
        [ div []
            [ span [ class "text-warning-content font-bold" ] [ text "Warning: " ]
            , text message
            ]
        ]
