module Pages.Account.Files.ALL_ exposing (Model, Msg, page)

import Api
import Api.Files
import Auth
import Components.Directory as Directory
import Data.Files as Files
import Effect exposing (Effect, withNoEff)
import Html as H
import Layouts
import Layouts.Main as Layout
import Page exposing (Page)
import Route exposing (Route)
import Shared
import Ui
import Util.Lens as L
import View exposing (View)


page : Auth.User -> Shared.Model -> Route { all_ : List String } -> Page Model Msg
page user _ route =
    Page.new
        { init = init (String.join "/" route.params.all_)
        , update = update
        , subscriptions = subscriptions
        , view = view
        }
        |> Page.withLayout (\_ -> Layouts.Main (Layout.props user))


type alias Model =
    { directory : Directory.Model }


init : String -> () -> ( Model, Effect Msg )
init path () =
    ( { directory = Directory.init path }
    , Api.Files.listDir path
        |> Effect.sendRequest DirectoryReceived
    )


type Msg
    = DirectoryMsg Directory.Msg
    | DirectoryReceived (Result Api.Error Files.Directory)


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        DirectoryMsg msg ->
            model
                |> L.map (Directory.update msg) L.directory
                |> withNoEff

        DirectoryReceived (Ok dir) ->
            { model | directory = Directory.Loaded dir } |> withNoEff

        DirectoryReceived _ ->
            { model | directory = Directory.Loading "error" } |> withNoEff


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> View Msg
view model =
    { title = "Directory: " ++ (model.directory |> Directory.path)
    , body =
        [ Ui.hero
            { title = "/files/" ++ (model.directory |> Directory.path)
            , description = "View your personal files"
            , attrs = []
            , children = []
            }
        , H.map DirectoryMsg (Directory.view model.directory)
        ]
    }
