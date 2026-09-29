import { admin } from "./admin";
import { auth } from "./auth";
import { course } from "./course";
import { exam } from "./exam";
import { grading } from "./grading";
import { profile } from "./profile";
import { question } from "./question";

export const server = { auth, profile, admin, course, exam, grading, question };
