-- Week 2 lab: the table every exercise reads from.
CREATE TABLE student (
    id       INTEGER PRIMARY KEY,
    username TEXT    NOT NULL UNIQUE,
    enrolled DATE    NOT NULL
);
