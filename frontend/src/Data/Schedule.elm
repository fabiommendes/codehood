module Data.Schedule exposing (Event, Schedule, TimeSlot, decoder, empty)

import Data.Datetime exposing (dateDecoder, posixDecoder)
import Date exposing (Date)
import Hour as Time exposing (Time(..))
import Json.Decode as D
import Json.Decode.Pipeline as D
import Time exposing (Month(..), Posix, Weekday(..))
import Util.EnumDecode exposing (enumDecode)


type alias Schedule =
    { start : Date
    , end : Date
    , events : List Event
    , timeSlots : List TimeSlot
    }


type alias TimeSlot =
    { day : Weekday
    , start : Time
    , end : Time
    }


type alias Event =
    { title : String
    , description : String
    , week : Int
    , isHoliday : Bool
    , start : Posix
    , end : Posix
    }


empty : Schedule
empty =
    { start = Date.fromCalendarDate 1970 Jan 1
    , end = Date.fromCalendarDate 1970 Jan 1
    , events = []
    , timeSlots = []
    }


weekday : List ( Weekday, String )
weekday =
    [ ( Mon, "monday" )
    , ( Tue, "tuesday" )
    , ( Wed, "wednesday" )
    , ( Thu, "thursday" )
    , ( Fri, "friday" )
    , ( Sat, "saturday" )
    , ( Sun, "sunday" )
    ]


timeSlotDecoder : D.Decoder TimeSlot
timeSlotDecoder =
    D.map3 TimeSlot
        (D.field "day" (enumDecode weekday D.string))
        (D.field "start" Time.decoder)
        (D.field "end" Time.decoder)


eventDecoder : D.Decoder Event
eventDecoder =
    D.map6 Event
        (D.field "title" D.string)
        (D.field "description" D.string)
        (D.field "week" D.int)
        (D.field "is_holliday" D.bool)
        (D.field "start" posixDecoder)
        (D.field "end" posixDecoder)


decoder : D.Decoder Schedule
decoder =
    D.map4 Schedule
        (D.field "start" dateDecoder)
        (D.field "end" dateDecoder)
        (D.field "events" (D.list eventDecoder))
        (D.field "time_slots" (D.list timeSlotDecoder))
