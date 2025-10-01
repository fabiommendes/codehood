module Components.LandingPage exposing (..)

import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)


type alias Model =
    ()


init : Model
init =
    ()


type Msg
    = NoOp


update : Msg -> Model -> Model
update msg model =
    case msg of
        NoOp ->
            model


view : Model -> Html msg
view model =
    div []
        [ heroSection model
        , featuresSection
        , coursesSection
        ]


heroSection : Model -> Html msg
heroSection _ =
    section
        [ class "text-white py-20 bg-cover bg-no-repeat"
        , style "background" "linear-gradient(rgba(0, 0, 0, 0.05), rgba(0, 0, 0, 0.25)), url(/static/img/pics/people.jpg)"
        , style "background-position" "center"
        ]
        (container
            [ div [ class "text-center" ]
                [ h1 [ class "text-5xl text-shadow-md text-shadow-black font-bold mt-12 mb-10 heading" ] [ text "Welcome to CodeHood" ]
                , p [ class "text-2xl text-shadow-xs text-shadow-black/70 m-12 text-white/80 heading" ] [ text "Learn programming, enroll in classes, and write code all in one place." ]
                , a [ href "/auth/login/", class "btn btn-secondary" ] [ text "Get Started" ]
                ]
            ]
        )


featuresSection : Html msg
featuresSection =
    section [ id "features", class "py-16 bg-gray-100" ]
        (container
            [ h2 [ class "text-2xl h2 font-bold text-center mb-8" ] [ text "Why Choose CodeHood?" ]
            , div [ class "grid grid-cols-1 md:grid-cols-3 gap-8" ]
                [ featureCard "Interactive Classes" "Enroll in programming classes designed for all skill levels, from beginner to advanced."
                , featureCard "Code Editor" "Write and save text-based files with source code directly on the platform."
                , featureCard "Community Support" "Join a vibrant community of students and mentors to collaborate and grow together."
                ]
            ]
        )


coursesSection : Html msg
coursesSection =
    section [ id "courses", class "py-16 bg-white" ]
        (container
            [ h2 [ class "text-2xl h2 font-bold text-center mb-8" ] [ text "Popular Courses" ]
            , div [ class "grid grid-cols-1 md:grid-cols-3 gap-8" ]
                [ courseCard "Introduction to Python" "Learn the basics of Python programming and start building your own projects."
                , courseCard "Web Development Bootcamp" "Master HTML, CSS, and JavaScript to create stunning websites."
                , courseCard "Data Structures & Algorithms" "Enhance your problem-solving skills with advanced programming concepts."
                ]
            ]
        )


container : List (Html msg) -> List (Html msg)
container children =
    [ div [ class "container mx-auto px-4" ] children ]


featureCard : String -> String -> Html msg
featureCard title description =
    div [ class "card prose bg-white shadow-md p-6" ]
        [ div [ class "card-body" ]
            [ h3 [ class "text-xl font-bold mb-2" ] [ text title ]
            , p [] [ text description ]
            ]
        ]


courseCard : String -> String -> Html msg
courseCard title description =
    div [ class "card prose bg-gray-100 shadow-md" ]
        [ div [ class "card-body" ]
            [ h3 [ class "text-xl font-bold mb-2" ] [ text title ]
            , p [] [ text description ]
            , a [ href "#", class "btn btn-primary mt-4" ] [ text "Enroll Now" ]
            ]
        ]


formField : String -> String -> String -> Html msg
formField labelText placeholderText inputType =
    div [ class "form-control mb-4" ]
        [ label [ class "label" ]
            [ span [ class "label-text" ] [ text labelText ] ]
        , input
            [ type_ inputType
            , placeholder placeholderText
            , class "input input-bordered w-full"
            ]
            []
        ]


formFieldTextarea : String -> String -> Html msg
formFieldTextarea labelText placeholderText =
    div [ class "form-control mb-4" ]
        [ label [ class "label" ]
            [ span [ class "label-text" ] [ text labelText ] ]
        , textarea [ placeholder placeholderText, class "textarea textarea-bordered w-full" ] []
        ]
