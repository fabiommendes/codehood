module Ui.Cards exposing (classroom, classrooms)

import Data.Classroom
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Maybe.Extra as Maybe
import Route.Path as Path


orEllipsis : (a -> String) -> Maybe a -> String
orEllipsis get model =
    model |> Maybe.map get |> Maybe.withDefault "..."


{-| Display a classroom
-}
classroom : Maybe Data.Classroom.Classroom -> Html msg
classroom cls =
    let
        title =
            cls |> orEllipsis .title

        instructor =
            cls |> orEllipsis (.instructor >> .name)

        description =
            cls |> orEllipsis .description

        badges =
            case cls of
                Just data ->
                    [ span [ class "badge badge-primary" ]
                        [ text (String.fromInt (data.students |> List.length) ++ " students") ]
                    , a
                        [ Path.href (Data.Classroom.toPath data)
                        , class "btn btn-accent"
                        ]
                        [ text "View Classroom" ]
                    ]

                _ ->
                    [ span [ class "badge badge-primary" ]
                        [ text "? students" ]
                    , a [ class "btn btn-accent" ] [ text "View Classroom" ]
                    ]
    in
    div [ class "card prose bg-white shadow-md rounded-lg p-6 m-4" ]
        [ h3 [ class "text-xl font-bold mb-2" ] [ text title ]
        , p [ class "text-base-content mb-2" ] [ text ("Instructor: " ++ instructor) ]
        , p [ class "text-text-base-content/50 mb-4" ] [ text description ]
        , div [ class "flex justify-between items-center" ] badges
        ]


{-| Display multiple classrooms
-}
classrooms : Maybe (List Data.Classroom.Classroom) -> Html msg
classrooms data =
    let
        body =
            case data of
                Just [] ->
                    [ p [ class "text-center text-gray-500" ] [ text "No classrooms available." ] ]

                Just elems ->
                    List.map (Just >> classroom) elems

                Nothing ->
                    List.map classroom [ Nothing, Nothing ]
    in
    div [ class "container mx-auto" ] body
