module Pages.Discipline_.Classroom_.Kind_.Exam_ exposing (Model, Msg, page)

import Api
import Api.Classrooms
import Api.Exams
import Api.Task as Task
import Auth
import Components.Question as Question
import Data.Classroom as Classroom exposing (Classroom)
import Data.Discipline as Discipline
import Data.Exam as Exam exposing (Exam)
import Data.Link as Link
import Effect exposing (Effect, withApiError, withEff, withEffs, withNoEff)
import Effect.Log exposing (LogLevel(..))
import Html as H exposing (..)
import Html.Attributes exposing (..)
import Layouts
import Layouts.Main as Layout
import List.Extra as List exposing (..)
import Page exposing (Page)
import Route exposing (Route)
import Route.Path as Path
import Shared
import Ui
import Ui.Container as Ui
import Ui.Exam
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
    { exam : Exam
    , pathParams : Exam.PathParams
    , classroom : Classroom
    , questions : List QuestionState
    }


type alias QuestionState =
    { question : Question.Model
    , isSelected : Bool
    }


init : Exam.PathParams -> () -> ( Model, Effect Msg )
init params () =
    let
        fetchData =
            Effect.attemptHttp DataReceived <|
                Task.map2 Tuple.pair
                    (Api.Classrooms.getClassroomFromParams params)
                    (Task.fromRequest <| Api.Exams.getExam (Exam.paramsToNaturalId params))
    in
    { exam = Exam.empty
    , pathParams = params
    , classroom = Classroom.empty
    , questions = []
    }
        |> withEff fetchData


type Msg
    = DataReceived (Result Api.Error ( Classroom.Classroom, Exam.Exam ))
    | AnswerSubmitted (Result Api.Error String)
    | QuestionMsg Int Question.Msg


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        DataReceived (Ok ( cls, exam )) ->
            { model
                | classroom = cls
                , exam = exam
                , questions = List.map (\q -> { question = q, isSelected = False }) exam.questions
            }
                |> withNoEff

        --|> withInnerEff L.inner
        --    { update = Inner.loadData exam
        --    , msg = InnerMsg
        --    }
        DataReceived (Err err) ->
            model
                |> withApiError err

        AnswerSubmitted (Ok _) ->
            model
                |> withEffs []

        AnswerSubmitted (Err err) ->
            model
                |> withApiError err

        QuestionMsg idx msg ->
            { model
                | questions =
                    List.updateAt idx
                        (L.map (Question.update msg) L.question)
                        model.questions
            }
                |> withNoEff


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> View Msg
view { exam, classroom, questions } =
    let
        viewQuestion : Int -> QuestionState -> Html Msg
        viewQuestion i { question } =
            Question.view { isSelected = False, isStandalone = False } question
                |> H.map (QuestionMsg i)

        questionsHtml =
            List.indexedMap viewQuestion questions
                |> List.intersperse (div [ class "divider" ] [])
    in
    { title = "Pages.Classroom_"
    , body =
        [ Ui.Exam.hero exam
        , Ui.breadcrumbs
            [ Discipline.toLink classroom.discipline
            , Classroom.toLink classroom
            , Link.link "Exams"
                (Path.Discipline__Classroom__Exams <| Classroom.toPathParams classroom)
            ]
            exam.title
        , if String.isEmpty exam.preamble then
            text ""

          else
            Ui.flat [] [ Ui.md exam.preamble ]
        , Ui.flat []
            (h2 [ class "h2" ] [ text "Questions" ]
                :: questionsHtml
            )
        ]
    }
