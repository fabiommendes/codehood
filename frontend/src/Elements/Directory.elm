module Elements.Directory exposing (Model(..), Msg(..), init, path, update, view)

{-| View Directories in a file
-}

import Data.Files as Files
import Html exposing (..)
import Html.Attributes exposing (..)
import Util exposing (..)


type Model
    = Loading String
    | Loaded Files.Directory


path : Model -> String
path model =
    case model of
        Loading value ->
            value

        Loaded dir ->
            dir.path


type Msg
    = NoOp


init : String -> Model
init p =
    Loading p


update : Msg -> Model -> Model
update msg model =
    case msg of
        NoOp ->
            model


view : Model -> Html Msg
view model =
    case model of
        Loading p ->
            div [] [ text ("Loading " ++ p) ]

        Loaded dir ->
            dir
                |> Files.sortedFolders
                |> .files
                |> viewFiles


viewFiles : List Files.File -> Html msg
viewFiles files =
    let
        firstRow =
            tr []
                [ td [] [ a [ class "link", href "../" ] [ text "..." ] ]
                , td [] []
                ]
    in
    table [ class "table" ]
        [ thead []
            [ tr []
                [ th [] []
                , th [] []
                ]
            ]
        , tbody [] (firstRow :: List.map viewFile files)
        ]


viewFile : Files.File -> Html msg
viewFile file =
    let
        name =
            Files.name file
    in
    tr []
        [ td [] [ a [ class "link", href name ] [ text name ] ]
        , td [] [ text (Files.showKind file.kind) ]
        ]
