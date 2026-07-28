import { Children, isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { signOutCurrentSession } from "./actions";
import AuthButton from "./auth-button";

describe("AuthButton", () => {
	it("GET 링크 대신 사용자 제출로만 로그아웃 Server Action을 실행한다", () => {
		const element = AuthButton({ email: "owner@example.com" });
		const form = Children.toArray(element.props.children).at(-1);

		expect(isValidElement(form)).toBe(true);
		const formElement = form as ReactElement<{
			action: typeof signOutCurrentSession;
			children: ReactElement<{ type?: string }>;
		}>;
		expect(formElement.type).toBe("form");
		expect(formElement.props.action).toBe(signOutCurrentSession);
		expect(formElement.props.children.props.type).toBe("submit");
	});
});
