module Mdq.Ui exposing (..)

import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Lazy exposing (lazy)
import Markdown exposing (..)
import Mdq.Question exposing (..)
import Mdq.Types exposing (..)


markdownOptions : Markdown.Options
markdownOptions =
    { githubFlavored = Just { tables = True, breaks = True }
    , defaultHighlighting = Just "markdown"
    , sanitize = False
    , smartypants = True
    }


preamble : { a | preamble : String, format : TextFormat } -> Html msg
preamble data =
    case data.format of
        "md" ->
            lazy (Markdown.toHtmlWith markdownOptions [ class "mdq-preamble prose" ]) data.preamble

        _ ->
            div [ class "mdq-preamble" ] [ text data.preamble ]
