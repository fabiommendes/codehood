module Ui.Exam exposing (..)

import Data.Datetime exposing (dueDate)
import Data.Exam exposing (Exam)
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Ui


hero : Exam -> Html msg
hero exam =
    Ui.hero
        { title = exam.title
        , description = exam.description
        , attrs = []
        , children =
            [ div [ class "text-sm text-right" ] [ strong [] [ text "Due: " ], text (dueDate exam.end) ] ]
        }
