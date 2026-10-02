import { admin } from "./admin";
import { auth } from "./auth";
import { course } from "./course";
import { exam } from "./exam";
import { gradeColumn } from "./grade-column";
import { grading } from "./grading";
import { profile } from "./profile";
import { question } from "./question";

export const server = {
	auth,
	profile,
	admin,
	course,
	exam,
	gradeColumn,
	grading,
	question,
};
