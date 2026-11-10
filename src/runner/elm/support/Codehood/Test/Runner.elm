port module Codehood.Test.Runner exposing (run)

{-| Runs a test suite and reports it, in the style of `elm-test`, through the
`report` port: the whole text and the exit code (0 when every test passed,
2 when one failed or the run was incomplete).
-}

import Codehood.Test.Format as Format
import Codehood.Test.Highlightable as Highlightable exposing (Highlightable)
import Random
import Test exposing (Test)
import Test.Runner exposing (Runner, SeededRunners(..))
import Test.Runner.Failure exposing (Reason)


port report : { output : String, code : Int } -> Cmd msg


port start : (Int -> msg) -> Sub msg


{-| Number of runs of each fuzz test. -}
fuzzRuns : Int
fuzzRuns =
    100


{-| A program that runs `suite` once, with the seed it gets on `start`.

The suite waits for `start` instead of running in `init`: a port command
sent from `init` goes out before JavaScript can subscribe to it.

-}
run : Test -> Program () () Int
run suite =
    Platform.worker
        { init = \_ -> ( (), Cmd.none )
        , update = \seed model -> ( model, report (execute seed suite) )
        , subscriptions = \_ -> start identity
        }


type alias Outcome =
    { passed : Int
    , failed : List String
    , todos : List String
    }


execute : Int -> Test -> { output : String, code : Int }
execute seed suite =
    case Test.Runner.fromTest fuzzRuns (Random.initialSeed seed) suite of
        Plain runners ->
            summarize seed Nothing (List.foldl runOne (Outcome 0 [] []) runners)

        Only runners ->
            summarize seed (Just "Test.only was used") (List.foldl runOne (Outcome 0 [] []) runners)

        Skipping runners ->
            summarize seed (Just "Test.skip was used") (List.foldl runOne (Outcome 0 [] []) runners)

        Invalid message ->
            { output = red "TEST RUN FAILED" ++ "\n\n" ++ message ++ "\n", code = 2 }


runOne : Runner -> Outcome -> Outcome
runOne runner outcome =
    let
        expectations =
            runner.run ()

        failures =
            List.filterMap Test.Runner.getFailureReason expectations
    in
    if List.isEmpty failures then
        { outcome | passed = outcome.passed + 1 }

    else if List.all Test.Runner.isTodo expectations then
        { outcome | todos = outcome.todos ++ [ String.join " > " (List.reverse runner.labels) ] }

    else
        { outcome | failed = outcome.failed ++ [ describe runner.labels failures ] }


describe :
    List String
    -> List { given : Maybe String, description : String, reason : Reason }
    -> String
describe labels failures =
    let
        heading =
            Test.Runner.formatLabels (\d -> "↓ " ++ d) (\t -> red ("✗ " ++ t)) labels
                |> String.join "\n"

        body failure =
            (case failure.given of
                Just given ->
                    "Given " ++ given ++ "\n\n"

                Nothing ->
                    ""
            )
                ++ Format.format highlight failure.description failure.reason
                |> indent
    in
    heading ++ "\n\n" ++ String.join "\n\n" (List.map body failures)


summarize : Int -> Maybe String -> Outcome -> { output : String, code : Int }
summarize seed incomplete outcome =
    let
        failed =
            List.length outcome.failed

        status =
            if failed > 0 then
                red "TEST RUN FAILED"

            else if incomplete /= Nothing || not (List.isEmpty outcome.todos) then
                yellow "TEST RUN INCOMPLETE"

            else
                green "TEST RUN PASSED"

        reasons =
            List.filterMap identity
                [ incomplete
                , if List.isEmpty outcome.todos then
                    Nothing

                  else
                    Just ("TODO: " ++ String.join ", " outcome.todos)
                ]

        code =
            if status == green "TEST RUN PASSED" then
                0

            else
                2
    in
    { output =
        String.join "\n\n"
            (("Running " ++ String.fromInt (outcome.passed + failed + List.length outcome.todos) ++ " tests (seed " ++ String.fromInt seed ++ ").")
                :: outcome.failed
                ++ [ status ++ String.concat (List.map (\r -> "\n" ++ r) reasons) ]
                ++ [ "Passed:   " ++ String.fromInt outcome.passed ++ "\nFailed:   " ++ String.fromInt failed ]
            )
            ++ "\n"
    , code = code
    }


highlight : List (Highlightable String) -> List (Highlightable String) -> ( String, String )
highlight expected actual =
    let
        render =
            List.map (Highlightable.resolve { fromHighlighted = red, fromPlain = identity })
                >> String.concat
    in
    ( render expected, render actual )


indent : String -> String
indent text =
    String.lines text
        |> List.map (\line -> "    " ++ line)
        |> String.join "\n"


red : String -> String
red text =
    "\u{001B}[31m" ++ text ++ "\u{001B}[0m"


green : String -> String
green text =
    "\u{001B}[32m" ++ text ++ "\u{001B}[0m"


yellow : String -> String
yellow text =
    "\u{001B}[33m" ++ text ++ "\u{001B}[0m"
