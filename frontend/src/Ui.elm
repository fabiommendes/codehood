module Ui exposing (..)

import Data.Link as Link exposing (Link)
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Html.Lazy
import Markdown
import Ui.Container


type Color
    = Primary
    | Secondary
    | Accent
    | Neutral
    | Base
    | Info
    | Success
    | Warning
    | Error
    | Base100
    | Base200
    | Base300


hero : { title : String, description : String, attrs : List (Html.Attribute msg), children : List (Html msg) } -> Html msg
hero { title, description, attrs, children } =
    div
        (class "bg-linear-to-br from-primary to-secondary text-primary-content p-8 -mb-2"
            :: attrs
        )
        ([ h1 [ class "h1 mb-4" ] [ text title ]
         , if description /= "" then
            p [ class "text-lg mb-4" ] [ md description ]

           else
            text ""
         ]
            ++ children
        )


breadcrumbs : List (Link msg) -> String -> Html msg
breadcrumbs data last =
    let
        -- home =
        --     li [ class "text-primary" ]
        --         [ a [ Path.href Path.Home_ ]
        --             [ Icons.view Icons.Home ]
        --         ]
        links =
            data |> List.map (Link.toPlain >> Link.view [] >> List.singleton >> li [ class "text-primary" ])
    in
    Ui.Container.flat [ class "compact text-sm mt-2" ]
        [ div [ class "breadcrumbs" ]
            [ ul []
                (if String.isEmpty last then
                    links

                 else
                    links ++ [ li [ class "opacity-70" ] [ text last ] ]
                )
            ]
        ]


md : String -> Html msg
md src =
    if String.isEmpty src then
        text ""

    else
        Html.Lazy.lazy (Markdown.toHtml [ class "prose" ]) src
