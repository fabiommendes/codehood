def synchronize(self, shallow: bool = False):
    """
    Reload and synchronize the entire course from local storage.
    """

    storage = self.storage()
    self.log_info(f"synchronizing {self} at {self.storage_path}", storage=storage)

    if not storage.exists(str(self.storage_path)):
        msg = f"creating course files at {self.storage_path}"
        self.log_warning(msg, storage=storage)
        storage.save(str(self.storage_path / "course.toml"), io.StringIO())

        self._sync_exams(storage)
        self._sync_questions(storage, "questions", self.questions_exam)
        self._sync_questions(storage, "exercises", self.exercises_exam)
        self._sync_submissions(storage)


def _sync_exams(self, storage: Storage):
    NotImplemented


def _sync_questions(self, storage: Storage, section: str, exam: Exam):
    root = self.storage_path / section
    dirs, files = storage.listdir(str(root))
    for file in files:
        question_path = root / file
        with storage.open(str(question_path), "r") as fd:
            source = fd.read()
            question = mdq.parse_question(source, filename=question_path)
            try:
                db_question = Question.objects.get(slug=question.slug, exam=exam)
            except Question.DoesNotExist:
                Question.objects.create(
                    exam=exam,
                    slug=question.slug,
                    path=str(question_path),
                    question_type=question.type,
                    data=question.model_dump(mode="json"),
                )
            else:
                db_question.data = question.model_dump_json()

    if dirs:
        msg = "Unrecognized directories under {self.slug}/questions/"
        self.log_warning(msg, storage=storage)


def _sync_submissions(self, storage: Storage):
    NotImplemented
