port module Effect.Layout exposing (Msg(..), decoder, encode, messages, sendMessage)

{-| Logging capabilities to the Effects module
-}

import Data.Menu
import Data.Path as Path
import Json.Decode as D
import Json.Encode as E
import Result.Extra as Result
import Route.Path exposing (Path)


port sendToLayout : E.Value -> Cmd msg


port layoutMessages : (E.Value -> msg) -> Sub msg


type Msg
    = AddNavbarSections (List Data.Menu.StaticMenu)
    | PageLoaded Path
    | Invalid E.Value


sendMessage : Msg -> Cmd msg
sendMessage msg =
    encode msg
        |> sendToLayout


messages : (Msg -> msg) -> Sub msg
messages onReceived =
    layoutMessages
        (\json ->
            D.decodeValue decoder json
                |> Result.withDefault (Invalid json)
                |> onReceived
        )



--- JSON encoding


decoder : D.Decoder Msg
decoder =
    D.field "tag" D.string
        |> D.andThen
            (\tag ->
                case tag of
                    "add-navbar-sections" ->
                        D.map AddNavbarSections
                            (D.field "data" (D.list Data.Menu.staticDecoder))

                    "page-loaded" ->
                        D.map PageLoaded
                            (D.field "data" Path.decoder)

                    _ ->
                        D.fail ("Unknown tag: " ++ tag)
            )


encode : Msg -> E.Value
encode msg =
    case msg of
        AddNavbarSections sections ->
            E.object
                [ ( "tag", E.string "add-navbar-sections" )
                , ( "data", E.list Data.Menu.encodeStatic sections )
                ]

        PageLoaded path ->
            E.object
                [ ( "tag", E.string "page-loaded" )
                , ( "data", Path.encode path )
                ]

        Invalid _ ->
            E.null
