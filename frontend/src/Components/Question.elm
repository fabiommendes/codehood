module Components.Question exposing
    ( Model
    , Msg(..)
    , init
    , update
    , view
    )

{-| An empty template component
-}

import Data.Answer as Answer exposing (Answer(..))
import Data.Question as Question exposing (Question)
import Data.Question.Essay as Essay
import Data.Question.MultipleChoice as MultipleChoice
import Data.Question.MultipleSelection as MultipleSelection
import Data.Question.TrueFalse as TrueFalse
import Effect exposing (Effect, withNoEff)
import Html as H exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Ui
import Util exposing (iff)


type alias Model =
    Question


type Msg
    = SetAnswer Answer.Answer
    | Skip
    | Submit
    | RequestFocus


init : Question -> ( Model, Effect Msg )
init question =
    question
        |> withNoEff


update : Msg -> Model -> Model
update msg model =
    case msg of
        SetAnswer f ->
            model
                |> Question.answer.set f

        _ ->
            model


{-| Returns an Html (Either msgExam msg)!

This is necessary because the children implement buttons that may send messages to
their parents

-}
view : { isSelected : Bool, isStandalone : Bool } -> Model -> Html Msg
view options model =
    let
        render =
            Ui.md

        viewFootnote footnote =
            div [ class "mdq-footnote" ]
                [ text (footnote.id ++ ": " ++ footnote.text) ]

        footnotes =
            div [ class "mdq-footnotes" ] (List.map viewFootnote (Question.footnotes model))

        title =
            h3 [ class "h3 text-primary" ] [ text (Question.title model) ]

        actions =
            div
                [ class "flex w-full justify-end" ]
                [ button
                    [ class "btn btn-primary mx-2 min-w-25 rounded-full hover:bg-primary-focus hover:transform-[scale(105%)] hover:shadow-lg"
                    , onClick Submit
                    ]
                    [ text "Send" ]
                ]

        content =
            viewInput options model

        body =
            [ render (Question.preamble model)
            , render (Question.stem model)
            , content
            , render (Question.epilogue model)
            , footnotes
            , actions
            ]

        html =
            -- if options.isStandalone then
            if True then
                title :: body

            else
                [ div
                    [ class "collapse collapse-arrow join-item border border-base-200 pl-6 pr-2"
                    , class <| iff options.isSelected "collapse-open" "collapse-close"
                    ]
                    [ div
                        [ class "prose collapse-title max-w-full"
                        , onClick RequestFocus
                        ]
                        [ title ]
                    , div [ class "collapse-content" ] body
                    ]
                ]
    in
    H.form
        [ onSubmit Submit

        -- , class (iff options.isStandalone "overflow-visible" "join join-vertical")
        , class "w-full"
        ]
        html


viewInput : { isSelected : Bool, isStandalone : Bool } -> Model -> Html Msg
viewInput _ model =
    let
        makeOptions tag =
            { onSetAnswer = tag >> SetAnswer }
    in
    case model of
        Question.EssayQuestion essay ->
            essay
                |> Essay.view (makeOptions Answer.EssayAnswer)

        Question.MultipleChoiceQuestion mc ->
            mc
                |> MultipleChoice.view (makeOptions Answer.MultipleChoiceAnswer)

        Question.MultipleSelectionQuestion ms ->
            ms
                |> MultipleSelection.view (makeOptions Answer.MultipleSelectionAnswer)

        Question.TrueFalseQuestion tf ->
            tf
                |> TrueFalse.view (makeOptions Answer.TrueFalseAnswer)



-- _ ->
--     div [ class "bg-error text-error-content p-4 text-2xl rounded" ] [ text "Invalid question type" ]
--------------------------------------------------------------------------------
---                           QUESTION RENDERERS                             ---
--------------------------------------------------------------------------------
-- mapEssay : (Essay.Answer -> Essay.Answer) -> Answer.Answer -> Answer.Answer
-- mapEssay f answer =
--     case answer of
--         EssayAnswer ans ->
--             EssayAnswer (f ans)
--         _ ->
--             answer
-- essayMsg : (Essay.Answer -> Essay.Answer) -> Msg
-- essayMsg f =
--     SetAnswer (mapEssay f)
-- mapChoices : (Set Id -> Set Id) -> Question.Answer -> Question.Answer
-- mapChoices f state =
--     case state of
--         MultipleChoiceAnswer { answer } ->
--             MultipleChoiceAnswer { answer = f answer }
--         MultipleSelectAnswer { answer } ->
--             MultipleSelectAnswer { answer = f answer }
--         _ ->
--             state
-- choicesMsg : (Set Id -> Set Id) -> Msg
-- choicesMsg f =
--     UpdateState (mapChoices f)
-- mapTrueFalse : (Dict Id Bool -> Dict Id Bool) -> Question.Answer -> Question.Answer
-- mapTrueFalse f state =
--     case state of
--         TrueFalseAnswer { answer } ->
--             TrueFalseAnswer { answer = f answer }
--         _ ->
--             state
-- trueFalseMsg : (Dict Id Bool -> Dict Id Bool) -> Msg
-- trueFalseMsg f =
--     UpdateState (mapTrueFalse f)
-- mapFillIn : (Dict Id String -> Dict Id String) -> Question.Answer -> Question.Answer
-- mapFillIn f state =
--     case state of
--         FillInAnswer { answer } ->
--             FillInAnswer { answer = f answer }
--         _ ->
--             state
-- fillInMsg : (Dict Id String -> Dict Id String) -> Msg
-- fillInMsg f =
--     UpdateState (mapFillIn f)
