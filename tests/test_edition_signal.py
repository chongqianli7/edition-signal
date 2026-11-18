import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest


class UserError(Exception):
    pass


def strict(fn):
    value = fn()
    if value != fn():
        raise UserError("NO_CONSENSUS")
    return value


api = types.ModuleType("genlayer")
api.TreeMap = dict
api.u32 = int
api.gl = types.SimpleNamespace(
    Contract=object,
    vm=types.SimpleNamespace(UserError=UserError),
    public=types.SimpleNamespace(view=lambda fn: fn, write=lambda fn: fn),
    message=types.SimpleNamespace(sender_address="curator"),
    eq_principle=types.SimpleNamespace(strict_eq=strict),
    nondet=types.SimpleNamespace(web=types.SimpleNamespace()),
)
sys.modules["genlayer"] = api
spec = importlib.util.spec_from_file_location("edition_signal", Path(__file__).parents[1] / "contracts/edition_signal.py")
code = importlib.util.module_from_spec(spec)
spec.loader.exec_module(code)


class EditionTest(unittest.TestCase):
    def test_user_error_uses_supported_vm_namespace(self):
        self.assertFalse(hasattr(api.gl, "UserError"))
        self.assertIs(api.gl.vm.UserError, UserError)

    def setUp(self):
        self.contract = code.EditionSignal()
        self.contract.editions = {}
        api.gl.message.sender_address = "curator"
        self.contract.freeze("test-edition", "2025-12-27", 2,
                             json.dumps([["Mars", "Science"], ["Venus", "Science"], ["Rome", "Places"], ["Music", "Culture"]]))

    def state(self):
        return json.loads(self.contract.edition("test-edition"))

    def response(self, title, baseline, recent):
        series = [{"timestamp":day + "00", "views":baseline if i < 7 else recent,
                   "article":title,"project":"en.wikipedia","agent":"user","access":"all-access","granularity":"daily"}
                  for i, day in enumerate(self.state()["days"])]
        return types.SimpleNamespace(status=200, body=json.dumps({"items":series}).encode())

    def test_rank_and_desk_capacity(self):
        for i, (name, recent) in enumerate([("Mars", 300), ("Venus", 250), ("Rome", 170), ("Music", 110)]):
            response = self.response(name, 100, recent)
            api.gl.nondet.web.get = lambda _: response
            self.contract.measure("test-edition", i)
        with self.assertRaisesRegex(UserError, "ALREADY_MEASURED"):
            self.contract.measure("test-edition", 0)
        self.contract.publish("test-edition")
        state = self.state()
        self.assertEqual(state["order"], [0, 2])
        self.assertEqual([r["decision"] for r in state["rows"]], ["SELECTED", "DESK_LIMIT", "SELECTED", "SLOT_LIMIT"])
        with self.assertRaisesRegex(UserError, "EDITION_PUBLISHED"):
            self.contract.publish("test-edition")

    def test_permissions_and_freeze(self):
        with self.assertRaisesRegex(UserError, "OBSERVATIONS_PENDING"):
            self.contract.publish("test-edition")
        api.gl.message.sender_address = "other"
        with self.assertRaisesRegex(UserError, "CURATOR_REQUIRED"):
            self.contract.publish("test-edition")
        self.assertEqual(self.state()["days"][5:7], ["20260101", "20260102"])

    def test_missing_series_and_upstream_failure(self):
        api.gl.nondet.web.get = lambda _: types.SimpleNamespace(status=404)
        self.contract.measure("test-edition", 0)
        self.assertEqual(self.state()["rows"][0]["status"], "NO_SERIES")
        api.gl.nondet.web.get = lambda _: types.SimpleNamespace(status=503)
        with self.assertRaisesRegex(UserError, "HTTP_503"):
            self.contract.measure("test-edition", 0)
        self.assertEqual(self.state()["rows"][0]["status"], "NO_SERIES")

    def test_divergence_and_missing_day(self):
        responses = iter([self.response("Mars", 100, 100), self.response("Mars", 100, 101)])
        api.gl.nondet.web.get = lambda _: next(responses)
        with self.assertRaisesRegex(UserError, "NO_CONSENSUS"):
            self.contract.measure("test-edition", 0)
        response = self.response("Mars", 100, 100)
        data = json.loads(response.body)
        data["items"].pop()
        response.body = json.dumps(data).encode()
        api.gl.nondet.web.get = lambda _: response
        with self.assertRaisesRegex(UserError, "INCOMPLETE_SERIES"):
            self.contract.measure("test-edition", 0)
        self.assertEqual(self.state()["rows"][0]["status"], "PENDING")
