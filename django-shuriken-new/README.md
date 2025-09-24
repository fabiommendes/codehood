Django Shuriken is a Django Ninja router that easily implement REST CRUD 
endpoints from a common configuration class. 


## Example

Given a Django model like 

```python
# employees/models.py

from django.db import models

class Employee(models.Model):
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    department = models.ForeignKey('Department', on_delete=models.CASCADE)
    birth_date = models.DateField()
```

You can create a CRUD router like this:

```python
# employees/api.py 

from shuriken import RestRouter


class EmployeeRestRouter(RestRouter):
    class Meta:
        model = Employee
        search_fields = ["first_name", "last_name"]
        filter_fields = ["department_id"]
```

Then include it in your main API router:

```python
# project/api.py
from ninja import NinjaAPI
from employees.api import EmployeeRestRouter

api = NinjaAPI()
api.add_router("/employees/", EmployeeRestRouter())
``` 
