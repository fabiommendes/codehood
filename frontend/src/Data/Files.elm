module Data.Files exposing (Directory, File, PathKind(..), decodeFile, name, showKind, sortedFolders)

import Json.Decode as D


type alias File =
    { path : String
    , kind : PathKind
    }


type alias Directory =
    { path : String
    , files : List File
    }


type PathKind
    = Text String
    | Binary
    | Folder


name : { a | path : String } -> String
name { path } =
    String.split "/" path
        |> List.foldl (\x _ -> x) ""


{-| Sort the list of files so files appear alphabetically with
directories showing before regular files
-}
sortedFolders : Directory -> Directory
sortedFolders { path, files } =
    { path = path
    , files =
        files
            |> List.sortBy (\file -> ( numeric (file.kind == Folder), file.path ))
    }


numeric : Bool -> Int
numeric bool =
    if bool then
        1

    else
        0


showKind : PathKind -> String
showKind value =
    case value of
        Binary ->
            "binary file"

        Text str ->
            str

        Folder ->
            "folder"



-------------------------------------------------------------------------------
--- Json encoders/decoders
-------------------------------------------------------------------------------


decodeFile : D.Decoder File
decodeFile =
    let
        decoder : D.Decoder PathKind
        decoder =
            D.map2 Tuple.pair
                (D.field "kind" D.string)
                (D.field "highlight_mode" (D.maybe D.string))
                |> D.andThen
                    (\( kind, highlight ) ->
                        case kind of
                            "dir" ->
                                D.succeed Folder

                            "txt" ->
                                D.succeed (Text (highlight |> Maybe.withDefault "text"))

                            "bin" ->
                                D.succeed Binary

                            _ ->
                                D.fail ("invalid kind: " ++ kind)
                    )
    in
    D.map2 File
        (D.field "path" D.string)
        decoder
