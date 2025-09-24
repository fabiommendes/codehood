module Ui exposing (..)

import Data.Link as Link exposing (Link)
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Html.Lazy
import Markdown
import Route.Path as Path
import Ui.Icons as Icons


contentHeader : { title : String, description : String } -> List (Html.Attribute msg) -> List (Html msg) -> Html msg
contentHeader data attrs children =
    div
        (class "bg-radial-[at_200%_100%] from-secondary/70 via-secondary/50 to-primary/70 text-secondary-content p-8 -mb-2"
            :: attrs
        )
        ([ h1 [ class "h1 mb-4" ] [ text data.title ]
         , if data.description /= "" then
            p [ class "text-lg mb-4" ] [ md data.description ]

           else
            text ""
         ]
            ++ children
        )


breadcrumbs : List (Link msg) -> String -> Html msg
breadcrumbs data last =
    let
        home =
            li [ class "text-primary" ]
                [ a [ Path.href Path.Home_ ]
                    [ Icons.view Icons.Home ]
                ]

        links =
            data |> List.map (Link.toPlain >> Link.view [] >> List.singleton >> li [ class "text-primary" ])
    in
    div [ class "container breadcrumbs text-sm" ]
        [ ul []
            (if String.isEmpty last then
                home :: links

             else
                home :: links ++ [ li [ class "opacity-70" ] [ text last ] ]
            )
        ]


md : String -> Html msg
md =
    Html.Lazy.lazy (Markdown.toHtml [ class "prose" ])
