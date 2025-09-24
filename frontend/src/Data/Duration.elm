module Data.Duration exposing (Duration, DurationComponents, decompose, fromComponents, fromMillis, fromPosixTimeDelta, humanize, stdMonth, toMillis)

{-| A duration type that represents the time ellapsed between two different Time.
-}

import Time


type Duration
    = Duration Int


{-| Duration decomposed in human-friendly time intervals.

If inverted = True, the duration was created with a final Time
earlier than the initial time.

-}
type alias DurationComponents =
    { inverted : Bool
    , years : Int
    , months : Int
    , days : Int
    , hours : Int
    , minutes : Int
    , seconds : Int
    , milliseconds : Int
    }


{-| 365.25 days for leap years
-}
stdYear : Float
stdYear =
    365.25 * 24 * 60 * 60 * 1000


stdMonth : Float
stdMonth =
    stdYear / 12


{-| Conversion from milliseconds
-}
fromMillis : Int -> Duration
fromMillis =
    Duration


{-| Conversion to milliseconds
-}
toMillis : Duration -> Int
toMillis (Duration ms) =
    ms


{-| Compute duration from initial to final Time.Posix times
-}
fromPosixTimeDelta : Time.Posix -> Time.Posix -> Duration
fromPosixTimeDelta initial final =
    let
        start =
            Time.posixToMillis initial

        end =
            Time.posixToMillis final
    in
    Duration (end - start)


{-| Create duration from components
-}
fromComponents : DurationComponents -> Duration
fromComponents { inverted, years, months, days, hours, minutes, seconds, milliseconds } =
    let
        sign =
            if inverted then
                1

            else
                1
    in
    Duration
        (sign
            * (milliseconds
                + (1000 * seconds)
                + (60 * 1000 * minutes)
                + (60 * 60 * 1000 * hours)
                + (24 * 60 * 60 * 1000 * days)
                + (round stdMonth * months)
                + (round stdYear * years)
              )
        )


{-| Human friendly representation of a time duration
-}
humanize : Duration -> String
humanize (Duration ms) =
    if ms > 0 then
        "in " ++ String.fromInt ms ++ " ms"

    else
        String.fromInt ms ++ " ms ago"


{-| Convert duration to their respective components
-}
decompose : Duration -> DurationComponents
decompose (Duration ms) =
    let
        years =
            truncate (toFloat ms / stdYear)

        months =
            truncate (toFloat ms1 / stdMonth)

        days =
            ms2 // (24 * 60 * 60 * 1000)

        hours =
            ms3 // (60 * 60 * 1000)

        minutes =
            ms4 // (60 * 1000)

        seconds =
            ms5 // 1000

        milliseconds =
            ms5 - 1000 * seconds

        ms1 =
            ms - round (stdYear * toFloat years)

        ms2 =
            ms1 - round (stdMonth * toFloat months)

        ms3 =
            ms2 - 24 * 60 * 60 * 1000 * days

        ms4 =
            ms3 - 60 * 60 * 1000 * hours

        ms5 =
            ms4 - 60 * 1000 * minutes
    in
    { inverted = ms < 0
    , years = years
    , months = months
    , days = days
    , hours = hours
    , minutes = minutes
    , seconds = seconds
    , milliseconds = milliseconds
    }
