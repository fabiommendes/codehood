module Data.Navbar exposing
    ( Navbar
    , navbar
    , view
    , withEnrolled
    , withSections
    )

{-| This module describes the Navbar component to the left of Codhood's UI.
-}

import Data.Classroom as Classroom exposing (Classroom)
import Data.Link as Link
import Data.Menu as Menu exposing (Menu)
import Elements.Directory exposing (Msg(..))
import Html exposing (..)
import Html.Attributes exposing (..)
import List.Extra as List
import Route.Path as Path
import Ui.Icons


type alias Navbar msg =
    { home : Menu msg
    , contextual : List (Menu Never)
    , enrolled : List Classroom
    }


navbar : { logout : msg } -> Navbar msg
navbar actions =
    { home =
        { title = ""
        , id = ""
        , links =
            [ Link.iconLink Ui.Icons.Home "Home" Path.Home_
            , Link.iconLink Ui.Icons.Home "Files" (Path.Account_Files_ALL_ { all_ = [] })
            , Link.actionLink "Logout" actions.logout |> Link.withIcon Ui.Icons.Home
            ]
        }
    , contextual = []
    , enrolled = []
    }


withSections : List (Menu Never) -> Navbar msg -> Navbar msg
withSections sections data =
    { data | contextual = sections }


withEnrolled : List Classroom -> Navbar msg -> Navbar msg
withEnrolled classes data =
    { data | enrolled = classes }


view : Navbar msg -> Html msg
view model =
    let
        closeNavbar =
            label
                [ for "main-drawer"
                , class "h-(--header-height) block w-full font-bold flex justify-end"
                , class "bg-linear-to-br from-primary/75 to-secondary/50 md:hidden"
                ]
                [ Ui.Icons.viewStyled "size-14 p-4 fill-white" Ui.Icons.ArrowLeft ]

        homeMenu =
            Menu.view model.home

        enrolledMenu =
            Menu.view <|
                { id = "enrolled"
                , title = "Enrolled Classrooms"
                , links = List.map Classroom.toLink model.enrolled
                }

        contextualMenu =
            model.contextual |> List.map (Menu.nonStatic >> Menu.view)
    in
    nav
        [ class "MainLayout-navbar textured-background bg-base-300 w-120 max-w-[90%] h-[100vh] z-10 "
        , class "p-0 overflow-x-hidden overflow-y-auto"
        , class "md:bg-none! md:bg-transparent md:h-auto md:max-w-none md:mt-4"
        ]
        (closeNavbar :: homeMenu :: (contextualMenu ++ [ enrolledMenu ]))
