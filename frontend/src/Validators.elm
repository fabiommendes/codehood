module Validators exposing (email)


email : String -> Bool
email data =
    String.contains "@" data
