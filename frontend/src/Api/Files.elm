module Api.Files exposing (..)

import Api
import Data.Files as Files
import Json.Decode as D
import Request


{-| List files on given path
-}
listDir :
    String
    -> Api.Request { path : String, files : List Files.File }
listDir path =
    Request.get
        { url = "/files/list"
        , expect = Request.expectJson (filesDecoder path)
        }
        |> Request.withQuery "path" path


filesDecoder path =
    D.list Files.decodeFile |> D.map (\files -> { path = path, files = files })
