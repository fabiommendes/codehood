module Pages.Discipline_ exposing (Model, Msg, page)

import Api
import Api.Disciplines
import Api.Task as Task
import Auth
import Data.Classroom exposing (Classroom)
import Data.Discipline as Data
import Effect exposing (Effect, withApiError, withEff, withNoEff)
import Elements.Discipline as Discipline
import Html as H
import Layouts
import Layouts.Main as Layout
import Page exposing (Page)
import Route exposing (Route)
import Shared
import Util.Lens as L
import View exposing (View)


page : Auth.User -> Shared.Model -> Route { discipline : String } -> Page Model Msg
page user _ route =
    Page.new
        { init = init route.params.discipline
        , update = update
        , subscriptions = subscriptions
        , view = view
        }
        |> Page.withLayout (\_ -> Layouts.Main (Layout.props user))


type alias Model =
    { discipline : Discipline.Model }


init : String -> () -> ( Model, Effect Msg )
init slug () =
    let
        task =
            Task.map2 Tuple.pair
                (Api.Disciplines.getDiscipline slug |> Task.fromRequest)
                (Api.Disciplines.getClassrooms slug |> Task.fromRequest |> Task.map .items)
    in
    { discipline = Discipline.init { id = slug, name = slug, description = "" } }
        |> withEff (task |> Effect.attemptHttp DataReceived)


type Msg
    = DisciplineMsg Discipline.Msg
    | DataReceived (Result Api.Error ( Data.Discipline, List Classroom ))


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        DataReceived (Ok ( data, classrooms )) ->
            model
                |> L.update L.discipline
                    (Discipline.update
                        (Discipline.DataLoaded data classrooms)
                    )
                |> withNoEff

        DataReceived (Err err) ->
            model
                |> withApiError err

        DisciplineMsg msg ->
            model
                |> L.map (Discipline.update msg) L.discipline
                |> withNoEff


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> View Msg
view model =
    { title = "Pages.Discipline_"
    , body =
        [ H.map DisciplineMsg (Discipline.view model.discipline) ]
    }
