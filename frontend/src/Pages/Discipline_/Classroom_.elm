module Pages.Discipline_.Classroom_ exposing (Model, Msg, page)

import Api
import Api.Classrooms
import Api.Task as Task
import Auth
import Data.Classroom as Data exposing (Classroom)
import Data.Discipline as Discipline
import Data.Schedule exposing (Schedule)
import Effect exposing (..)
import Elements.Classroom as Inner
import Html as H
import Html.Attributes as HA
import Layouts
import Layouts.Main as Layout
import Page exposing (Page)
import Route exposing (Route)
import Shared
import Ui
import Util.Lens as L
import View exposing (View)


page : Auth.User -> Shared.Model -> Route { discipline : String, classroom : String } -> Page Model Msg
page user _ route =
    Page.new
        { init = init user route.params
        , update = update
        , subscriptions = subscriptions
        , view = view
        }
        |> Page.withLayout (\_ -> Layouts.Main (Layout.props user))


type alias Model =
    { inner : Inner.Model
    , isLoading : Bool
    , user : Auth.User
    }


init : Auth.User -> { discipline : String, classroom : String } -> () -> ( Model, Effect Msg )
init user params () =
    let
        task =
            Api.Classrooms.getClassroomFromParams params
                |> Task.andThen
                    (\cls ->
                        (Api.Classrooms.getSchedule cls.id |> Task.fromRequest)
                            |> Task.map (\schedule -> ( cls, schedule ))
                    )
    in
    { inner = Inner.empty, user = user, isLoading = True }
        |> withEffs [ Effect.attemptHttp DataReceived task ]


type Msg
    = InnerMsg Inner.Msg
    | DataReceived (Result Api.Error ( Classroom, Schedule ))


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        InnerMsg msg ->
            model
                |> L.update L.inner (Inner.update msg)
                |> withNoEff

        DataReceived (Ok ( cls, schedule )) ->
            model
                |> L.inner.set (Inner.init model.user cls)
                |> L.isLoading.set False
                |> withEffs
                    [ Effect.sendMsg (InnerMsg (Inner.UpdateSchedule schedule))
                    , Effect.navbarSections [ Data.contextualMenu cls ]
                    ]

        DataReceived (Err err) ->
            model
                |> withApiError err


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> View Msg
view { inner } =
    let
        classroom =
            inner.data
    in
    { title = "Pages.Classroom_"
    , body =
        [ Ui.contentHeader
            { title = classroom.title
            , description = classroom.description
            }
            []
            [ H.span [ HA.class "badge badge-primary" ] [ H.text (String.fromInt inner.studentsCount ++ " Students") ]
            ]
        , Ui.breadcrumbs [ Discipline.toLink classroom.discipline ] classroom.edition
        , H.map InnerMsg (Inner.view inner)
        ]
    }
