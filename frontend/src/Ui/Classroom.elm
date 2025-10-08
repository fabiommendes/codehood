module Ui.Classroom exposing (..)

import Data.Classroom exposing (Classroom)
import Data.Exam as Exam exposing (Exam)
import Data.Schedule exposing (Schedule)
import Date
import Hour
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Route.Path as Path
import Time
import Ui
import Util exposing (..)


hero : Classroom -> Html msg
hero classroom =
    let
        studentsCount =
            classroom.students |> List.length
    in
    Ui.hero
        { title = classroom.title
        , description = classroom.description
        , attrs = []
        , children =
            [ span [ class "badge badge-primary" ]
                [ text (String.fromInt studentsCount ++ " Students") ]
            ]
        }


subscriptionCodeDialog :
    { isOpen : Bool
    , isInstructor : Bool
    , subscriptionCode : String
    , onToggle : msg
    }
    -> List (Html msg)
subscriptionCodeDialog { isOpen, onToggle, subscriptionCode, isInstructor } =
    let
        toggle =
            if isOpen then
                attribute "open" "open"

            else
                class ""
    in
    if isInstructor then
        [ div [ class "stats shadow" ]
            [ dl [ class "stat" ]
                [ dt [ class "stat-title" ] [ text "Subscription code" ]
                , dd [ class "stat-value" ]
                    [ text subscriptionCode
                    , button [ class "btn btn-sm", onClick onToggle ]
                        [ text "Show" ]
                    ]
                ]
            ]
        , node "dialog"
            [ class "modal", toggle ]
            [ div [ class "modal-box text-center py-12" ]
                [ Html.form [ method "dialog" ]
                    [ button
                        [ class "btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
                        , onClick onToggle
                        ]
                        [ text "x" ]
                    ]
                , h3 [ class "h2" ] [ text "Subscription code" ]
                , p [ class "py-4 text-5xl" ]
                    [ text subscriptionCode ]
                ]
            ]
        ]

    else
        []


schedule : List (Attribute msg) -> Schedule -> Html msg
schedule attrs model =
    let
        viewEvent i event =
            let
                date =
                    Date.fromPosix Time.utc event.start
                        |> Date.format "MMMM ddd, EE"

                times =
                    [ event.start, event.end ]
                        |> List.map
                            (Hour.fromPosix Time.utc
                                >> Hour.floor Hour.Quarter
                                >> Hour.toIsoString
                            )
                        |> String.join " - "
            in
            li [ class "collapse bg-base-100 shadow-sm border border-base-300", tabindex (i + 1) ]
                [ div [ class "collapse-title text-gt font-semibold text-base-content/70 flex justify-between px-4 pt-4 bg-base-200" ]
                    [ span [] [ text date ]
                    , span [ class "text-base-content/50 text-sm" ] [ text times ]
                    ]
                , if event.description /= "" then
                    div [ class "collapse-content p-0" ]
                        [ div [ class "text-lg text-primary px-4 py-2 bg-base-200/50 font-bold" ] [ Ui.md event.title ]
                        , div [ class "text-base mt-2 p-4" ] [ Ui.md event.description ]
                        ]

                  else
                    div [ class "collapse-content p-0 bg-base-200/50" ]
                        [ div [ class "px-4 pt-2 text-primary text-lg font-bold" ] [ Ui.md event.title ] ]
                ]
    in
    div attrs [ div [] (List.indexedMap viewEvent model.events) ]


examsList : Classroom -> List (Attribute msg) -> List Exam -> Html msg
examsList cls attrs exams =
    if List.isEmpty exams then
        p (class "p-4" :: attrs) [ text "None for today :)" ]

    else
        ul (class "menu menu-compact" :: attrs)
            (exams
                |> List.map
                    (\exam ->
                        li []
                            [ a [ Path.href (Exam.toPath cls exam) ]
                                [ span [ class "font-bold" ] [ text exam.title ]
                                , if exam.description /= "" then
                                    p [ class "text-sm" ] [ Ui.md exam.description ]

                                  else
                                    text ""
                                ]
                            ]
                    )
            )
