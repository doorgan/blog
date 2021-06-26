---
title: "A deep dive into the Elixir AST: Building a static code analyzer"
date: "2021-04-16"
image: "/assets/img/posts/a_deep_dive_into_the_elixir_ast_cover.png"
tags:
  - elixir
  - ast
  - macros
---

Part 3 of The Elixir AST series. Analyzing the AST to build a static code analyzer.

<!-- excerpt -->

{% cover_img "a_deep_dive_into_the_elixir_ast_cover.png" "iex> quote do: sum(1, 2, 3); {:sum, [], [1, 2, 3]" %}

---

This article was split into three parts:

- [Part one: The Elixir AST](/posts/2021/04/the_elixir_ast/)
- [Part two: The Elixir AST: Building a typed struct macro](/posts/2021/04/the_elixir_ast_typedstruct/)
- [Part three: The Elixir AST: Building a static code analyzer](/posts/2021/04/the_elixir_ast_analyzer/)

---

The most common use case for working with the AST are macros, but there is some other cool stuff we can do with it. There is a popular tool called [credo](https://github.com/rrrene/credo), which describes itself as "A static code analysis tool for the Elixir language with a focus on code consistency and teaching". At a high level, when you run it, it scans you project, parses your source files, and emits warnings if it detects "antipatterns", like unsafe conversion from strings to atoms.

We will be building a much simplified version of credo, but similar enough in spirit so that by the end of the article you will be able to write your own checks for that library.

Our little library `Creed` will work as follows:

1. It loads a file and parses it into an Elixir AST
2. I passes the AST to a list of predefined check modules that will analyze it and return any issues they find
3. It prints the results of the analysis

Before we can focus on the analysis part, we need a bit of setup to support steps `1` and `3`:

```elixir

defmodule Creed do
  defmodule Checker do
    @type issue :: %{
      message: String.t,
      line: integer,
      columns: integer
    }

    @callback run(ast :: any) :: [issue]
  end

  @checkers []

  def run(file_path) do
    ast =
      file_path
      |> Path.expand()
      |> File.read!()
      |> Code.string_to_quoted(columns: true)

    issues =
      Enum.map(@checkers, fn checker -> checker.run(ast) end)
      |> List.flatten()

    Enum.each(issues, fn issue -> print_issue(file_path, issue) end)

    :ok
  end

  defp print_issue(file, issue) do
    [
    :reset, :yellow,
    issue.message, "\n",
    :faint,
    "#{file}:#{issue.line}:#{issue.column}\n",
    :reset
    ]
    |> IO.ANSI.format()
    |> IO.puts
  end
end
```

First we define a `Checker` behaviour for our checkers, this way we can ensure that they all implement a `run/1` function that returns a list of issues.
The `Creed.run/1` function will take a file path, read its content, and parse them to an Elixir AST with `Code.string_to_quoted/2`. We mentioned earlier that the AST metadata contains information like the line number, and now we will need them to tell the user where the issue was found. By default, the parser won't include the column numbers in the metadata, so we need to pass the `columns: true` option. There's an additional `:token_metadata` option that we can set to `true` to collect even more data about a node, like `do`/`end` positions, sigils delimiters, or the position where a function call's parenthesis are closed. A complete reference of metadata added by Elixir in different contexts is available at the [Macro.metadata](https://hexdocs.pm/elixir/Macro.html#t:metadata/0) type docs.

After parsing the code, the resulting AST is then fed to the checkers. Since checkers return a list of issues, we end up with a list of lists, so we flatten it.
Finally, we pass each issue through a function that prints them using ANSI coloring.

Now that we have our little framework in place, we can start writing our first check.

This check will look for any call to `String.to_atom` and warn us about an unsafe conversion from strings to atoms.
The AST for such call will be a dot operator call with the `String` alias and `:to_atom` arguments:

```elixir
quote do
  String.to_atom()
end
#=> {{:., [], [{:__aliases__, [], [:String]}, :to_atom]}, [], []}
```

So we will need to traverse the AST looking for such pattern. Elixir provides a straightforward way to perform traversals through the AST via the `prewalk`, `postwalk` and `traverse` functions from the `Macro` module. These functions perform depth-first traversals, which means it will go as deep as it can into the tree, and then calling your callback function as it backtracks, until it visits all nodes in the tree. The callback function allows you to modify the visited node, and it also lets you pass an accumulator in a similar fashion to `Enum.reduce`. For this code analyzer we will just use `Macro.postwalk`, and the accumulator to store the issues as we find them.

Great, now that we have all we need, let's look at the code:

```elixir
defmodule UnsafeToAtomCheck do
  @behaviour Creed.Checker

  @message "Creating atoms from unknown or external sources dynamically is a potentially unsafe operation because atoms are not garbage-collected by the runtime. Prefer the use of `String.to_existing_atom` instead."

  @impl true
  def run(ast) do
    {_ast, issues} = Macro.postwalk(ast, [], &traverse/2)
    issues
  end

  defp traverse({{:., _, [{:__aliases__, _, [:String]}, :to_atom]},
    meta, _args} = node, acc) do
    issue = %{
      message: @message,
      line: meta[:line],
      column: meta[:column]
    }
    {node, [issue | acc]}
  end

  defp traverse(node, acc), do: {node, acc}
end
```

We define the `run/1` function that will be called by `Creed` with the AST, and then we use `Macro.postwalk/3` to traverse it with a `traverse/2` function. This traverse function is the one that does the heavy work.

The first clause matches against a call to `String.to_atom` with the pattern we saw earlier:

```elixir
quote do
  String.to_atom()
end
#=> {{:., [], [{:__aliases__, [], [:String]}, :to_atom]}, [], []}
```

If that pattern matches, then we extract the line and column numbers from the call metadata and build an issue map that gets added to the accumulator(ie: the issues list). If it doesn't match, then it is a node we're not interested in so we do nothing. Notice that we need to return both the node and the accumulator in a tuple, since `postwalk` allows us to modify the AST.

Now we need to tell `Creed` that we want to use this check by adding it to the `@checkers` attribute:

```elixir
@checkers [UnsafeToAtomCheck]
```

And we can now give it a try. Let's create a `creed_test.ex` somewhere in our project folder with some code that uses `String.to_atom`:

```elixir
# creed_test.ex
defmodule Foo do
  def bar(x) do
    String.to_atom(x)
  end
end
```

And now let's run `Creed` against it via IEx:

```elixir
iex> Creed.run("creed_test.ex")
Creating atoms from unknown or external sources dynamically is a potentially unsafe operation because atoms are not garbage-collected by the runtime. Prefer the use of `String.to_existing_atom` instead.
checker_test.exs:3:11

:ok
```

It works!

Now we'll try with a slightly more complicated check. We will now look for multi alias syntax, and recommend using multiple aliases in individual lines instead.
Let's remind ourselves what the multi alias syntax looks like as AST:

```elixir
quote do
  Foo.{Bar, Baz}
end
{{:., [], [{:__aliases__, [], [:Foo]}, :{}]}, [],
 [
   {:__aliases__, [], [:Bar]},
   {:__aliases__, [], [:Baz]}
 ]}
```

The important bit here is the `{:., [], [{:__aliases__, [], [:Foo]}, :{}]}` call, since it's what indicates us that we're in a qualified tuple call, which is what the multi alias syntax uses.
Additionally, we want to check if that happens in the context of a module alias, like this:

```elixir
alias Foo.{Bar, Baz}
```

This is quite simple to spot, since it's just a non-qualified `{:alias, [], [args]}` call, where args will be the multi alias call.

Now the idea is the same as in the previous check: we traverse the AST, and we build an issue if we find that pattern:

```elixir
defmodule MultiAliasCheck do
  @behaviour Creed.Checker

  @message """
  Multi alias expansion makes module uses harder to search for in large code bases.
      # Preferred
      alias Foo.Boo
      alias Foo.Baz

      # NOT preferred
      alias Foo.{Bar, Baz}
  """

  @impl true
  def run(ast) do
    {_ast, issues} = Macro.postwalk(ast, [], &traverse/2)
    issues
  end

  defp traverse({
    :alias, _,
    [{
      {:., _, [{:__aliases__, meta, _}, :{}]},
      _, _
    }]
  } = node, acc) do
    issue = %{
      message: @message,
      line: meta[:line],
      column: meta[:column]
    }
    {node, [issue | acc]}
  end

  defp traverse(node, acc), do: {node, acc}
end
```

Now we add it to `Creed`'s checkers list:

```elixir
@checkers [UnsafeToAtomCheck, MultiAliasCheck]
```

Let's also modify our testing file and add a multi alias:

```elixir
# creed_test.ex
defmodule Foo do
  alias Some.{Multi, Aliased, Modules}

  def bar(x) do
    String.to_atom(x)
  end
end
```

And run `Creed`:

```elixir
iex> Creed.run("creed_test.ex")
Multi alias expansion makes module uses harder to search for in large code bases.
    # Preferred
    alias Foo.Boo
    alias Foo.Baz

    # NOT preferred
    alias Foo.{Bar, Baz}

checker_test.exs:2:9

Creating atoms from unknown or external sources dynamically is a potentially unsafe operation because atoms are not garbage-collected by the runtime.
checker_test.exs:5:11

:ok
```

Awesome! We have a fully functional checker!
Credo checks work in a very similar way, the difference being that it also provides a lot of tools to aid you, like helpers for generating issues, and some more ergonomic traversal functions. If you made it this far, you should be able to get comfortable writing your own credo checks.

# Final words

We have learned quite a bit through this article. The Elixir AST itself is quite simple when you look at its basic shapes, but it can get quite complex for larger programs. Isolating little bits of syntax makes it much easier to see what's going on and to develop a general sense of what it is representing. We learned most(all?) of the possible shapes an AST node can take and how they are combined to create meaningful programs, and we leveraged this knowledge to create useful tools for our day to day programming work.

I originally intended to also consider the AST from the perspective of a code formatter, but the Elixir parser discards a lot of useful information that makes this task a bit harder to achieve. The Elixir formatter passes some options to both the Elixir tokenizer and parser, and uses some other language escape hatches(like the process dictionary) to preserve comments and other useful information. It then builds an algebra document based on the method described in the Strictly Pretty paper by Christian Lindig, which is used to finally pretty print the source code. This in itself deserves a separate article to discuss it in detail, and escapes the scope of this one, which is studying the Elixir AST.

I had lots of fun digging into this topic and finding examples to bring all those concepts to a more tangible shape. I hope this was informative and that it helps you to build your own tools and understand other people's AST manipulation code.

- [Part one: The Elixir AST](/posts/2021/04/the_elixir_ast/)
- [Part two: The Elixir AST: Building a typed struct macro](/posts/2021/04/the_elixir_ast_typedstruct/)
