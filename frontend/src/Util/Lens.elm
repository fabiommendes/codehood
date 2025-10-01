module Util.Lens exposing (..)

{-| A simple lenses library

Create a lens for a field of a record like this:

    type alias Person =
        { name : String }

    name : Lens Person String
    name =
        Lens .name (\name m -> { m | name = name })

Then you can use then lens get and set methods directly:

    person =
        { name = "John" }

    name.get person
    -- "John"

    name.set "Jane" person
    -- { name = "Jane" }

@docs Lens, view, set, over, lens

-}


{-| A lens that focuses on a field of a record
-}
type alias Lens a b =
    { get : a -> b
    , set : b -> a -> a
    }


{-| Transforms the focused element using some function.
-}
map : (b -> b) -> Lens a b -> a -> a
map f lens m =
    lens.set (f (lens.get m)) m


{-| Transforms an optional focused element using some function.
-}
maybeMap : (b -> b) -> Lens a (Maybe b) -> a -> a
maybeMap f lens m =
    case lens.get m of
        Just b ->
            lens.set (Just (f b)) m

        Nothing ->
            m


{-| Update the focused element using some function.

Its equal to map with the two first arguments flipped.

-}
update : Lens a b -> (b -> b) -> a -> a
update lens f m =
    lens.set (f (lens.get m)) m


{-| Chains two lenses together.

This is used to focus on a field of a record that is itself a record.

-}
chain : Lens a b -> Lens b c -> Lens a c
chain outer inner_ =
    { get = inner_.get << outer.get
    , set =
        \c a ->
            let
                b =
                    outer.get a
            in
            outer.set (inner_.set c b) a
    }



-------------------------------------------------------------------------------
-- COMMON LENSES: keep it alphabetically sorted
-------------------------------------------------------------------------------


classroom : Lens { a | classroom : b } b
classroom =
    Lens .classroom (\v m -> { m | classroom = v })


classrooms : Lens { a | classrooms : b } b
classrooms =
    Lens .classrooms (\v m -> { m | classrooms = v })


credentials : Lens { a | credentials : b } b
credentials =
    Lens .credentials (\v m -> { m | credentials = v })


data : Lens { a | data : b } b
data =
    Lens .data (\v m -> { m | data = v })


directory : Lens { a | directory : b } b
directory =
    Lens .directory (\v m -> { m | directory = v })


discipline : Lens { a | discipline : b } b
discipline =
    Lens .discipline (\v m -> { m | discipline = v })


email : Lens { a | email : b } b
email =
    Lens .email (\v m -> { m | email = v })


error : Lens { a | error : b } b
error =
    Lens .error (\v m -> { m | error = v })


exam : Lens { a | exam : b } b
exam =
    Lens .exam (\v m -> { m | exam = v })


githubId : Lens { a | githubId : b } b
githubId =
    Lens .githubId (\v m -> { m | githubId = v })


header : Lens { a | header : b } b
header =
    Lens .header (\v m -> { m | header = v })


home : Lens { a | home : b } b
home =
    Lens .home (\v m -> { m | home = v })


id : Lens { a | id : b } b
id =
    Lens .id (\v m -> { m | id = v })


inner : Lens { a | inner : b } b
inner =
    Lens .inner (\v m -> { m | inner = v })


isLoading : Lens { a | isLoading : b } b
isLoading =
    Lens .isLoading (\v m -> { m | isLoading = v })


keepSignedIn : Lens { a | keepSignedIn : b } b
keepSignedIn =
    Lens .keepSignedIn (\v m -> { m | keepSignedIn = v })


links : Lens { a | links : b } b
links =
    Lens .links (\v m -> { m | links = v })


login : Lens { a | login : b } b
login =
    Lens .login (\v m -> { m | login = v })


logout : Lens { a | logout : b } b
logout =
    Lens .logout (\v m -> { m | logout = v })


logoutDialog : Lens { a | logoutDialog : b } b
logoutDialog =
    Lens .logoutDialog (\v m -> { m | logoutDialog = v })


model : Lens { a | model : b } b
model =
    Lens .model (\v m -> { m | model = v })


name : Lens { a | name : b } b
name =
    Lens .name (\v m -> { m | name = v })


navbar : Lens { a | navbar : b } b
navbar =
    Lens .navbar (\v m -> { m | navbar = v })


password : Lens { a | password : b } b
password =
    Lens .password (\v m -> { m | password = v })


question : Lens { a | question : b } b
question =
    Lens .question (\v m -> { m | question = v })


questions : Lens { a | questions : b } b
questions =
    Lens .questions (\v m -> { m | questions = v })


register : Lens { a | register : b } b
register =
    Lens .register (\v m -> { m | register = v })


schedule : Lens { a | schedule : b } b
schedule =
    Lens .schedule (\v m -> { m | schedule = v })


selected : Lens { a | selected : b } b
selected =
    Lens .selected (\v m -> { m | selected = v })


sidebar : Lens { a | sidebar : b } b
sidebar =
    Lens .sidebar (\v m -> { m | sidebar = v })


schoolId : Lens { a | schoolId : b } b
schoolId =
    Lens .schoolId (\v m -> { m | schoolId = v })


showSidebar : Lens { a | showSidebar : b } b
showSidebar =
    Lens .showSidebar (\v m -> { m | showSidebar = v })


state : Lens { a | state : b } b
state =
    Lens .state (\v m -> { m | state = v })


step : Lens { a | step : b } b
step =
    Lens .step (\v m -> { m | step = v })


style : Lens { a | style : b } b
style =
    Lens .style (\v m -> { m | style = v })


subscriptionCodeOverlay : Lens { a | subscriptionCodeOverlay : b } b
subscriptionCodeOverlay =
    Lens .subscriptionCodeOverlay (\v m -> { m | subscriptionCodeOverlay = v })


token : Lens { a | token : b } b
token =
    Lens .token (\v m -> { m | token = v })


user : Lens { a | user : b } b
user =
    Lens .user (\v m -> { m | user = v })


username : Lens { a | username : b } b
username =
    Lens .username (\v m -> { m | username = v })


waiting : Lens { a | waiting : b } b
waiting =
    Lens .waiting (\v m -> { m | waiting = v })


windowSize : Lens { a | windowSize : b } b
windowSize =
    Lens .windowSize (\v m -> { m | windowSize = v })
