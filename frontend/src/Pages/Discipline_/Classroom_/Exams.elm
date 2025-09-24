module Pages.Discipline_.Classroom_.Exams exposing (Model, Msg, page)

import Api
import Api.Classrooms as Api
import Api.Exams as Api
import Api.Task as Task
import Auth
import Data.Classroom as Classroom
import Data.Discipline as Discipline
import Data.Exam as Data
import Effect exposing (Effect, withApiError, withEffs, withNoEff)
import Elements.ExamIndex as Exams
import Html as H
import Layouts
import Layouts.Main as Layout
import Page exposing (Page)
import Route exposing (Route)
import Shared
import Ui
import Util exposing (..)
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
    { data : Exams.Model
    , isLoading : Bool
    , user : Auth.User
    }


init : Auth.User -> { discipline : String, classroom : String } -> () -> ( Model, Effect Msg )
init user params _ =
    { data = Exams.init, user = user, isLoading = True }
        |> withEffs
            [ Api.getClassroomFromParams params
                |> Task.andThen
                    (\cls ->
                        Api.getExamsForClassroom cls.id
                            |> Task.fromRequest
                            |> Task.map (\exams -> ( cls, exams.items ))
                    )
                |> Effect.attemptHttp DataReceived
            ]


type Msg
    = ExamsMsg Exams.Msg
    | DataReceived (Result Api.Error ( Classroom.Classroom, List Data.Exam ))


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        ExamsMsg msg ->
            model
                |> L.update L.data (Exams.update msg)
                |> withNoEff

        DataReceived (Ok ( cls, exams )) ->
            model
                |> L.update L.data (L.classroom.set cls)
                |> L.update L.data (L.data.set exams)
                |> L.isLoading.set False
                |> withNoEff

        DataReceived (Err err) ->
            model
                |> withApiError err


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> View Msg
view model =
    let
        data =
            model.data
    in
    { title = "Pages.Classroom_"
    , body =
        [ Ui.contentHeader { description = "", title = "Exams" } [] []
        , Ui.breadcrumbs
            [ Discipline.toLink data.classroom.discipline
            , Classroom.toLink data.classroom
            ]
            "List of exams"
        , H.map ExamsMsg (Exams.view model.data)
        ]
    }
