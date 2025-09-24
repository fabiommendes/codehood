module Mdq.Components.MultipleChoice exposing (..)

import Array exposing (Array)
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Mdq.Question as Question
import Mdq.Types exposing (MultipleChoiceQuestion)


type alias Model =
    { question : MultipleChoiceQuestion
    , selected : Maybe Int
    , feedback : Maybe String
    }


init : Model
init =
    { question =
        { question = Question.init "mcq" "Multiple Choice Question"
        , choices =
            Array.fromList
                [ { id = "a", text = "Answer is 42" }
                , { id = "b", text = "Bad answer" }
                , { id = "c", text = "Right answer" }
                , { id = "d", text = "Another bad answer" }
                ]
        , grading_strategy = "simple"
        , penalty = 0
        }
    , selected = Nothing
    , feedback = Nothing
    }


type Msg
    = Skip
    | Submit (Maybe String)
    | SelectChoice Int


update : Msg -> Model -> Model
update msg model =
    case msg of
        SelectChoice index ->
            { model | selected = Just index }

        _ ->
            model


view : Model -> Html Msg
view model =
    let
        viewChoice index choice =
            li [ class "mdq-choice" ]
                [ input
                    [ type_ "radio"
                    , id (String.fromInt index)
                    , name model.question.question.id
                    , checked (Just index == model.selected)
                    , onClick (SelectChoice index)
                    ]
                    []
                , label [ for (String.fromInt index) ] [ text choice.text ]
                ]

        selectedId =
            model.selected
                |> Maybe.andThen (\i -> Array.get i model.question.choices)
                |> Maybe.map .id
    in
    Html.form [ class "mdq-multiple-choice", onSubmit (Submit selectedId) ]
        ([ ul [] (Array.indexedMap viewChoice model.question.choices |> Array.toList) ]
            |> viewQuestion model.question { onSkip = Skip, onSubmit = Submit selectedId }
        )


viewQuestion :
    { a | question : Question.Question }
    -> { onSubmit : msg, onSkip : msg }
    -> List (Html msg)
    -> List (Html msg)
viewQuestion { question } conf extra =
    let
        viewFootnote footnote =
            div [ class "mdq-footnote" ]
                [ text (footnote.id ++ ": " ++ footnote.text) ]
    in
    List.concat
        [ [ h2 [] [ text question.title ]
          , p [] [ text question.preamble ]
          , p [] [ text question.stem ]
          ]
        , extra
        , [ p [] [ text question.epilogue ]
          , div [ class "mdq-footnotes" ] (List.map viewFootnote question.footnotes)
          , div []
                [ a [ class "btn btn-secondary", onClick conf.onSkip ] [ text "Skip" ]
                , a [ class "btn btn-primary", onClick conf.onSubmit ] [ text "Submit" ]
                ]
          ]
        ]
