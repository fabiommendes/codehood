module Elements.Classroom exposing (Model, Msg(..), empty, init, update, view)

{-| An empty template component
-}

import Auth
import Data.Classroom as Data
import Data.Schedule exposing (Event, Schedule, TimeSlot)
import Data.User
import Date exposing (Date)
import Hour
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (onClick)
import Time
import Ui
import Util exposing (..)
import Util.Lens as L


type alias Model =
    { data : Data.Classroom
    , studentsCount : Int
    , subscriptionCode : String
    , timeSlots : List TimeSlot
    , events : List Event
    , duration : ( Date, Date )
    , subscriptionCodeOverlay : Bool
    , isInstructor : Bool
    }


type Msg
    = ToggleSubscriptionCodeOverlay
    | UpdateSchedule Schedule


init : Auth.User -> Data.Classroom -> Model
init user cls =
    { data = cls
    , studentsCount = cls.students |> List.length
    , subscriptionCode = ""
    , subscriptionCodeOverlay = False
    , timeSlots = []
    , events = []
    , duration = ( Date.fromOrdinalDate 1970 1, Date.fromOrdinalDate 1970 1 )
    , isInstructor = user.role == Data.User.Instructor
    }


empty : Model
empty =
    { data = Data.empty
    , studentsCount = 0
    , subscriptionCode = ""
    , subscriptionCodeOverlay = False
    , timeSlots = []
    , events = []
    , duration = ( Date.fromOrdinalDate 1970 1, Date.fromOrdinalDate 1970 1 )
    , isInstructor = False
    }


update : Msg -> Model -> Model
update msg model =
    case msg of
        ToggleSubscriptionCodeOverlay ->
            model
                |> L.map not L.subscriptionCodeOverlay

        UpdateSchedule schedule ->
            { model
                | timeSlots = schedule.timeSlots
                , events = schedule.events
                , duration = ( schedule.start, schedule.end )
            }


view : Model -> Html Msg
view model =
    let
        subCode =
            viewSubscriptionCodeDialog model

        schedule =
            div [ class "p-4" ]
                [ h2 [ class "h2 font-bold mb-4 text-primary" ]
                    [ text "Classroom Schedule" ]
                , ul [ class "space-y-4" ]
                    (List.map viewEvent model.events)
                ]
    in
    div []
        (subCode ++ [ schedule ])


viewSubscriptionCodeDialog : Model -> List (Html Msg)
viewSubscriptionCodeDialog model =
    let
        toggle =
            if model.subscriptionCodeOverlay then
                attribute "open" "open"

            else
                class ""
    in
    if model.isInstructor then
        [ div [ class "stats shadow" ]
            [ dl [ class "stat" ]
                [ dt [ class "stat-title" ] [ text "Subscription code" ]
                , dd [ class "stat-value" ]
                    [ text model.subscriptionCode
                    , button [ class "btn btn-sm", onClick ToggleSubscriptionCodeOverlay ]
                        [ text "Show" ]
                    ]
                ]
            ]
        , node "dialog"
            [ class "modal", toggle ]
            [ div [ class "modal-box text-center py-12" ]
                [ Html.form [ method "dialog" ]
                    [ button
                        [ class "btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
                        , onClick ToggleSubscriptionCodeOverlay
                        ]
                        [ text "x" ]
                    ]
                , h3 [ class "h2" ] [ text "Subscription code" ]
                , p [ class "py-4 text-5xl" ]
                    [ text model.subscriptionCode ]
                ]
            ]
        ]

    else
        []


viewEvent : Event -> Html msg
viewEvent event =
    let
        date =
            Date.fromPosix Time.utc event.start
                |> Date.format "MMMM ddd, EE"

        times =
            [ event.start, event.end ]
                |> List.map
                    (Hour.fromPosix Time.utc
                        >> Hour.floor Hour.Quarter
                        >> Hour.toIsoString
                    )
                |> String.join " - "
    in
    li [ class "card bg-base-100 shadow-md border border-base-300 rounded-lg" ]
        [ div [ class "text-gt font-semibold text-base-content/50 flex justify-between px-4 pt-4 bg-base-200" ]
            [ span [] [ text date ]
            , span [] [ text times ]
            ]
        , div [ class "text-lg font-bold text-primary px-4 py-2 bg-base-200" ] [ Ui.md event.title ]
        , div [ class "text-base mt-2 p-4" ] [ Ui.md event.description ]
        ]
