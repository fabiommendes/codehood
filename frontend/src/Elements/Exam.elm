module Elements.Exam exposing (Model, Msg(..), init, loadData, update, view)

{-| An empty template component
-}

import Data.Answer as Answer
import Data.Datetime exposing (dueDate)
import Data.Exam as Data exposing (Exam)
import Data.Question as Question
import Data.Question.Essay as Essay
import Effect exposing (Effect, withEff, withEffs, withNoEff)
import Elements.Question as Question
import Html exposing (..)
import Html.Attributes exposing (..)
import List.Extra as List exposing (..)
import Util.Lens as L


type alias Id =
    String


type alias Model =
    { data : Exam
    , selected : Int
    , questions : List Question.Model
    }


type Msg
    = QuestionMsg Int Question.Msg
    | Submit ( Id, Answer.Answer )
    | Finish


init : ( Model, Effect Msg )
init =
    { data = Data.empty
    , selected = 0
    , questions = []
    }
        |> withEffs []


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        Finish ->
            model |> withNoEff

        QuestionMsg idx Question.RequestFocus ->
            model
                |> L.selected.set idx
                |> withNoEff

        QuestionMsg idx Question.Skip ->
            model
                |> L.selected.set ((idx + 1) |> modBy (List.length model.questions))
                |> withNoEff

        QuestionMsg idx Question.Submit ->
            let
                question =
                    List.getAt idx model.questions
                        |> Maybe.withDefault nullQuestion
                        |> .data

                id =
                    Question.id question

                submit =
                    case Question.answer.tryGet question of
                        Just ans ->
                            Effect.sendMsg (Submit ( id, ans ))

                        Nothing ->
                            Effect.none

                eff =
                    Effect.batch
                        [ Effect.sendMsg (QuestionMsg idx Question.Skip)
                        , submit
                        ]
            in
            model
                |> withEff eff

        QuestionMsg idx msg ->
            let
                ( question, eff ) =
                    model.questions
                        |> List.getAt idx
                        |> Maybe.map (Question.update msg)
                        |> Maybe.withDefault ( nullQuestion, Effect.none )

                questions =
                    model.questions |> List.setAt idx question
            in
            model
                |> L.questions.set questions
                |> withEff (Effect.map (QuestionMsg idx) eff)

        Submit _ ->
            model
                |> withNoEff


view : Model -> Html Msg
view { data, questions, selected } =
    div [ class "bg-base-100 p-8 rounded-lg space-y-4 w-200 mt-8 mx-auto" ]
        [ div [ class "text-xl font-bold text-primary" ] [ text data.title ]
        , div [ class "text-secondary" ] [ text ("Due: " ++ dueDate data.end) ]
        , div []
            [ text "Questions:"
            , viewQuestions selected questions
            ]
        ]


loadData : Exam -> Model -> ( Model, Effect Msg )
loadData data_ model =
    let
        fold i qst ( effs, models ) =
            let
                ( m, eff ) =
                    Question.init qst
            in
            ( Effect.map (QuestionMsg i) eff :: effs, m :: models )

        ( batch, questions ) =
            data_.questions
                |> List.indexedFoldr fold ( [], [] )
    in
    { model | data = data_, questions = questions }
        |> withEffs batch


viewQuestions : Int -> List Question.Model -> Html Msg
viewQuestions selected questions =
    let
        isStandalone =
            questions
                |> List.drop 1
                |> List.isEmpty

        body =
            questions
                |> List.indexedMap
                    (\i question ->
                        let
                            style =
                                { isStandalone = isStandalone
                                , isSelected = selected == i
                                }
                        in
                        Question.view style question
                            |> Html.map (QuestionMsg i)
                    )
    in
    if isStandalone then
        div [ class "space-y-4" ]
            (div [ class "divider" ] [] :: body)

    else
        div [ class "collapse border border-base-300" ]
            body


nullQuestion : Question.Model
nullQuestion =
    Essay.init
        { id = ""
        , title = "<error>"
        , stem = "<internal error>"
        }
        |> Question.EssayQuestion
        |> Question.init
        |> Tuple.first
