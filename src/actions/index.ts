import { installErrorMap } from "@/forms/error-map";
import { admin } from "./admin";
import { auth } from "./auth";
import { checkIn } from "./check-in";
import { course } from "./course";
import { exam } from "./exam";
import { gradeColumn } from "./grade-column";
import { grading } from "./grading";
import { profile } from "./profile";
import { question } from "./question";
import { regrade } from "./regrade";
import { report } from "./report";
import { repository } from "./repository";
import { rollCall } from "./roll-call";

installErrorMap();

export const server = {
	auth,
	profile,
	admin,
	course,
	exam,
	gradeColumn,
	grading,
	question,
	regrade,
	report,
	repository,
	rollCall,
	checkIn,
};
