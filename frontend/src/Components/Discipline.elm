module Components.Discipline exposing (Model, Msg(..), init, update, view)

{-| An empty template component
-}

import Data.Classroom exposing (Classroom)
import Data.Discipline as Data exposing (Discipline)
import Html exposing (..)
import Html.Attributes exposing (..)
import Route.Path as Path
import Ui
import Ui.Cards as Cards
import Ui.Icons as Icons
import Util exposing (..)


type alias Model =
    { data : Discipline
    , classrooms : List Classroom
    , loaded : Bool
    }


type Msg
    = DataLoaded Discipline (List Classroom)


init : Discipline -> Model
init data =
    { data = data
    , classrooms = []
    , loaded = False
    }


update : Msg -> Model -> Model
update msg model =
    case msg of
        DataLoaded data classrooms ->
            { model | data = data, classrooms = classrooms, loaded = True }


view : Model -> Html Msg
view { data, classrooms, loaded } =
    let
        header =
            Ui.hero
                { title = data.name
                , description = data.description
                }
                []
                [ span [ class "badge badge-accent" ]
                    [ Html.text (String.fromInt (List.length classrooms) ++ " Classrooms Available") ]
                ]

        breadcrumbs =
            div [ class "breadcrumbs text-sm" ]
                [ ul []
                    [ li [ class "text-primary" ]
                        [ a [ Path.href Path.Home_ ]
                            [ Icons.view Icons.Home ]
                        ]
                    , li [ class "text-primary" ]
                        [ a [ iff loaded (Path.href <| Path.Discipline_ { discipline = data.id }) (class "") ]
                            [ text data.name ]
                        ]
                    ]
                ]

        cardListClasses =
            "grid grid-cols-1"
    in
    div []
        [ header
        , breadcrumbs
        , if not loaded then
            div [ class cardListClasses ]
                [ Cards.classroom Nothing ]

          else if List.isEmpty classrooms then
            div [ class cardListClasses ] [ emptyState data.name ]

          else
            div [ class cardListClasses ]
                (List.map (Just >> Cards.classroom) classrooms)
        ]


emptyState : String -> Html msg
emptyState name =
    div [ class "text-center bg-white p-8" ]
        [ h2 [ class "text-xl font-bold text-gray-700 mb-4" ]
            [ Html.text ("No Classrooms Available for " ++ name) ]
        , p [ class "text-gray-600 mb-6" ]
            [ Html.text "It seems there are no classrooms available for this discipline at the moment. Please check back later or explore other disciplines." ]
        , a [ href "/", class "btn btn-primary" ]
            [ Html.text "Explore Other Disciplines" ]
        ]
