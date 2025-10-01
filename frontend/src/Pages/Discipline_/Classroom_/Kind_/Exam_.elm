module Pages.Discipline_.Classroom_.Kind_.Exam_ exposing (Model, Msg, page)

import Api
import Api.Classrooms
import Api.Exams
import Api.Task as Task
import Auth
import Data.Answer as Answer
import Data.Classroom as Classroom
import Data.Discipline as Discipline
import Data.Exam as Exam
import Data.Link as Link
import Effect exposing (Effect, withApiError, withEffs, withInnerEff)
import Effect.Log exposing (LogLevel(..))
import Elements.Exam as Inner
import Html as H
import Layouts
import Layouts.Main as Layout
import Page exposing (Page)
import Route exposing (Route)
import Route.Path as Path
import Shared
import Ui
import Ui.Classroom
import Util exposing (..)
import Util.Lens as L
import View exposing (View)


page : Auth.User -> Shared.Model -> Route { discipline : String, classroom : String, kind : String, exam : String } -> Page Model Msg
page user _ route =
    Page.new
        { init = init route.params
        , update = update
        , subscriptions = subscriptions
        , view = view
        }
        |> Page.withLayout (\_ -> Layouts.Main (Layout.props user))


type alias Model =
    { inner : Inner.Model
    , params : Exam.PathParams
    , classroom : Classroom.Classroom
    }


init : Exam.PathParams -> () -> ( Model, Effect Msg )
init params () =
    let
        ( inner, eff ) =
            Inner.init

        task1 =
            Api.Classrooms.getClassroomFromParams params

        task2 =
            Api.Exams.getExam (Exam.paramsToNaturalId params)
                |> Task.fromRequest

        taskCombined =
            Task.map2 Tuple.pair task1 task2
    in
    { inner = inner
    , params = params
    , classroom = Classroom.empty
    }
        |> withEffs
            [ taskCombined
                |> Effect.attemptHttp DataReceived
            , Effect.map InnerMsg eff
            ]


type Msg
    = InnerMsg Inner.Msg
    | DataReceived (Result Api.Error ( Classroom.Classroom, Exam.Exam ))
    | AnswerSubmitted (Result Api.Error String)


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        InnerMsg (Inner.Submit ( id, answer )) ->
            let
                -- _ =
                --     Debug.log "Submit" ( id, answer )
                request =
                    Api.Exams.postAnswer
                        { params = model.params
                        , answer = Answer.encode id answer
                        }
            in
            model
                |> withEffs [ Effect.sendRequest AnswerSubmitted request ]

        InnerMsg msg ->
            model
                |> withInnerEff L.inner
                    { update = Inner.update msg
                    , msg = InnerMsg
                    }

        DataReceived (Ok ( cls, exam )) ->
            model
                |> L.classroom.set cls
                |> withInnerEff L.inner
                    { update = Inner.loadData exam
                    , msg = InnerMsg
                    }

        DataReceived (Err err) ->
            model
                |> withApiError err

        AnswerSubmitted (Ok _) ->
            model
                |> withEffs []

        AnswerSubmitted (Err err) ->
            model
                |> withApiError err


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> View Msg
view { inner, classroom } =
    { title = "Pages.Classroom_"
    , body =
        [ Ui.Classroom.hero classroom
        , Ui.breadcrumbs
            [ Discipline.toLink classroom.discipline
            , Classroom.toLink classroom
            , Link.link "Exams"
                (Path.Discipline__Classroom__Exams <| Classroom.toPathParams classroom)
            ]
            inner.data.title
        , H.map InnerMsg (Inner.view inner)
        ]
    }
