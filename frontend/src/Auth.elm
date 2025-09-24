module Auth exposing (User, onPageLoad, viewCustomPage)

import Auth.Action
import Data.User
import Dict
import Route exposing (Route)
import Route.Path
import Shared
import View exposing (View)


type alias User =
    Data.User.User


{-| Called before an auth-only page is loaded.
-}
onPageLoad : Shared.Model -> Route () -> Auth.Action.Action User
onPageLoad shared route =
    case shared.credentials of
        Just credentials ->
            Auth.Action.loadPageWithUser credentials.user

        Nothing ->
            Auth.Action.pushRoute
                { path = Route.Path.Auth_Login
                , query = Dict.fromList [ ( "from", route.url.path ) ]
                , hash = Nothing
                }


{-| Renders whenever `Auth.Action.loadCustomPage` is returned from `onPageLoad`.
-}
viewCustomPage : Shared.Model -> Route () -> View Never
viewCustomPage _ _ =
    View.fromString "Loading..."
