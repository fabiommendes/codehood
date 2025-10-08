module Pages.Discipline_.Classroom_ exposing (Model, Msg, page)

import Api
import Api.Classrooms
import Api.Exams
import Api.Task as Task
import Auth
import Data.Classroom as Classroom exposing (Classroom)
import Data.Discipline as Discipline
import Data.Exam as Exam exposing (Exam)
import Data.Schedule as Schedule exposing (Schedule)
import Data.User as User
import Effect exposing (..)
import Html exposing (..)
import Html.Attributes exposing (..)
import Layouts
import Layouts.Main as Layout
import Page exposing (Page)
import Route exposing (Route)
import Shared
import Ui
import Ui.Classroom
import Ui.Container
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
    { classroom : Classroom
    , schedule : Schedule
    , subscriptionCode : String
    , subscriptionCodeOverlay : Bool
    , exercises : List Exam
    , exams : List Exam
    , quizzes : List Exam
    , isLoading : Bool
    , user : Auth.User
    }


type Msg
    = DataReceived (Result Api.Error ( Classroom, Schedule ))
    | ExamsReceived (Result Api.Error (Api.Paginated Exam))
    | ToggleSubscriptionCodeOverlay


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
    { classroom = Classroom.empty
    , schedule = Schedule.empty
    , subscriptionCode = ""
    , subscriptionCodeOverlay = False
    , isLoading = True
    , exercises = []
    , exams = []
    , quizzes = []
    , user = user
    }
        |> withEffs [ Effect.attemptHttp DataReceived task ]


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        DataReceived (Ok ( cls, schedule )) ->
            { model
                | classroom = cls
                , isLoading = False
                , schedule = schedule
            }
                |> withEff
                    (Effect.batch
                        [ Effect.navbarSections [ Classroom.contextualMenu cls ]
                        , Effect.sendRequest ExamsReceived (Api.Exams.getExamsForClassroom cls.id)
                        ]
                    )

        ExamsReceived (Ok paginated) ->
            let
                categorize e ( xs, ys, zs ) =
                    case e.kind of
                        Exam.Practice ->
                            ( e :: xs, ys, zs )

                        Exam.Quiz ->
                            ( xs, e :: ys, zs )

                        Exam.Standard ->
                            ( xs, ys, e :: zs )

                        _ ->
                            ( xs, ys, zs )

                ( exercises, exams, quizzes ) =
                    List.foldr categorize ( [], [], [] ) paginated.items
            in
            { model
                | exercises = exercises
                , exams = exams
                , quizzes = quizzes
            }
                |> withNoEff

        ExamsReceived (Err err) ->
            model
                |> withApiError err

        DataReceived (Err err) ->
            model
                |> withApiError err

        ToggleSubscriptionCodeOverlay ->
            model
                |> L.map not L.subscriptionCodeOverlay
                |> withNoEff


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> View Msg
view model =
    let
        { classroom, schedule, user } =
            model

        examList =
            Ui.Classroom.examsList classroom

        assignments =
            if List.isEmpty model.exams && List.isEmpty model.quizzes then
                examList [ class "collapse-content p-0" ] []

            else if List.isEmpty model.exams then
                examList [ class "collapse-content p-0" ] model.quizzes

            else if List.isEmpty model.quizzes then
                examList [ class "collapse-content p-0" ] model.exams

            else
                div [ class "collapse-content p-0" ]
                    [ h3 [ class "h3" ] [ text "Exams" ]
                    , examList [] model.exams
                    , h3 [ class "h3" ] [ text "Quizzes" ]
                    , examList [] model.quizzes
                    ]
    in
    { title = "Pages.Classroom_"
    , body =
        [ Ui.Classroom.hero classroom
        , Ui.breadcrumbs [ Discipline.toLink classroom.discipline ] classroom.edition
        , div []
            (Ui.Classroom.subscriptionCodeDialog
                { isOpen = model.subscriptionCodeOverlay
                , isInstructor = user.role == User.Instructor
                , subscriptionCode = model.subscriptionCode
                , onToggle = ToggleSubscriptionCodeOverlay
                }
            )
        , Ui.Container.flat []
            [ h2 [ class "h2 pb-4" ] [ text "Schedule" ]
            , Ui.Classroom.schedule [ id "classroom-schedule" ] schedule
            ]
        , div [ class "join join-vertical" ]
            [ Ui.Container.primary [ class "collapse collapse-arrow join-item" ]
                [ input [ type_ "radio", name "classroom-accordion", checked True ] []
                , h2 [ class "h2 collapse-title p-0" ] [ text "Practice" ]
                , examList [ class "collapse-content p-0" ] model.exercises
                ]
            , Ui.Container.secondary [ class "collapse collapse-arrow join-item" ]
                [ input [ type_ "radio", name "classroom-accordion" ] []
                , h2 [ class "h2 collapse-title p-0" ] [ text "Assessments" ]
                , assignments
                ]
            ]
        ]
    }
