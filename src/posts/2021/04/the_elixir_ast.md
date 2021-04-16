---
title: "A deep dive into the Elixir AST"
date: "2021-04-16"
image: "/assets/img/posts/a_deep_dive_into_the_elixir_ast_cover.png"
tags:
- elixir
- ast
- macros
---

Exploring in detail the Elixir AST, and then using it to build a macro and a static code checker.

<!-- excerpt -->

{% cover_img "a_deep_dive_into_the_elixir_ast_cover.png" "iex> quote do: sum(1, 2, 3); {:sum, [], [1, 2, 3]" %}

Before I start, I want to thank GenericJam from the [Elixir Discord server](https://discord.com/invite/elixir) for motivating me to write this article, and to Łukasz Jan Niemier (aka @hauleth) for pointing me to the missing pieces I needed to have a complete picture of the AST shape.

---

Metaprogramming is an important feature in Elixir. It gives you the ability to write code that, when compiled, gets transformed into a different version of itself. This kind of code is called a *macro*, and is popullarily referred to as "code that writes code".

For this to work, a macro function needs to have access to the language's internal representation of the source code. This is tipically a tree-shaped data structure called an *Abstract Syntax Tree*. For example, the expression `1 + 2 * 4` would be conceptually represented by this tree:
```
  +
 / \
1   *
   / \
  2   4
```
In many progrmaming languages the AST representation of the code is hidden from the user, but Elixir makes it available to you and it even allows you to manipulate it at will. A macro would receive that tree, process it, and output a new version, adding or removing elements from the tree, or just analyzing it. For instance, it could compute the result of the expression at compile time, and turn the previous example tree into just `9`. A real-life example of macros are the functions from the `Logger` module. The [`Logger.debug/2`](https://hexdocs.pm/logger/Logger.html#debug/2) macro will emit a debug level message during development, but it will be completely removed from your code in a production environment. To take things even further, many of Elixir's basic building blocks are implemented as macros themselves, like `defmodule`, `def`, and even `defmacro`.

Being such an important aspect of the language, Elixir provides tools to work with the AST, in a way that it's not only limited to macros. There are tools to parse a string into an Elixir AST and to aid in it's traversal which, among other use cases, also enables you to perform static code analysis of Elixir source code.

Whether you want to write a macro or to analyze Elixir code, you will be working with it's AST representation. Getting comfortable with reading and writing it is vital for this kind of task, and that's where the focus of this article will be. I'm not going to focus on the process of evaluating when a macro is needed or how to design it, but in analyzing the AST they receive. I will first attempt to cover what the AST looks like, what kind of shapes and combinations are possible, and then we will apply that to build two little projects: a macro to generate typed structs, and a little code style checker.

# The AST

To know what is the AST representation of some Elixir code, we can use the [quote/2](https://hexdocs.pm/elixir/Kernel.SpecialForms.html#quote/2) macro:
```elixir
quote do
  "Hello world!"
end
#=> "Hello world!"
```
In this example the expression was just a string literal, which is represented by itself in the AST. This is usually the case for the *leaf* nodes in the AST, and I will expand on this later. For now, lets try with a slightly more complicated example:
```elixir
quote do
  1 + 2
end
#=> {:+, [], [1, 2]}
```
That 3-tuple is representing this AST node:
```md
 +
/ \
1 2
```
What can be inferred here is that non-leaf AST nodes are represented as three element tuples, where the first element is an expression identifying the node type, and the last element is a list of children. The middle element is a list with *metadata* about the node, like the line number and column. We'll see more examples of metadata through the article, but for now it can be ignored. In most examples the metadata will be an empty list for the sake of brevity, but I will actually use it later in the code style checker section.

With those two examples, it should be possible to understand the `1 + 2 * 4` expression's AST means:
```elixir
quote do
  1 + 2 * 4
end
#=> {:+, [], [1, {:*, [], [2, 4]}]}
```
First, the outer tuple `{:+, [], [...]}` is the call to `+/2`, then the children are the literal `1` and a call to `*/2`, with `2` and `4` as it's children.

Since `quote/2` is the primitive by which code is turned into data, Elixir calls the AST a *quoted expression*. The AST term has the advantage of familiarity among developers, so most of the time both terms are use interchangeably, even in the official Elixir documentation.

One thing to note so far is that some literals are expressed by themselves. In many languages, literals would have their own representation, for instance in JavaScript the literal `1` would be expressed by the object `{type: 'Literal', value: 1}`. This is not the case in Elixir, and one explanation for this is that it makes it easier to work with them in macros, as matching on literals is much less verbose than matching against nested 3-tuples. However, one of the downsides of this is that information about the position or context of a literal is lost.

## What makes an AST

As shown above, some Elixir terms can be represented by themselves. To be precise, these cases are:
* atoms, like `:ok`
* integers, such as `42`
* floats like `13.1`
* strings like `"hello"`
* lists such as `[1, 2, 3]`
* tuples with two elements, like `{"hello", :world}`

<small>Note: This listing is borrowed from the Elixir AST section in the [Elixir syntax reference](https://hexdocs.pm/elixir/master/syntax-reference.html#the-elixir-ast)</small>

This means that trying to quote any of those expressions will result in a no-op:
```elixir
quote do
  {:foo, :bar}
end
#=> {:foo, :bar}
```

The reason 2-tuples are a special case, is that it allows keyword lists to be expressed as literals. It makes it easier to pass options to macros, and it makes it also easier to identify `do`/`end` blocks by pattern matching against `[do: block]`.

Every other kind of expression is represented by a 3-tuple that can represent *variables* or *calls*.

### Variables

Variables are represented by a 3-tuple where the first element is an atom representing it's name, the second is the node's metadata, and the third is an atom representing the context of the variable:
```elixir
quote do
  foo
end
#=> {:foo, [], Elixir}
```
If this code is run in IEx, the context will be `Elixir`. However, if `Code.string_to_quoted!` is used instead, the context will be `nil`, as there was no environment in which the expression was resolved:
```elixir
Code.string_to_quoted!("foo")
#=> {:foo, [line: 1], nil}
```
The resolution context can be injected into a quoted expression with the `:context` option:
```elixir
quote context: Foo do
  bar
end
#=> {:bar, [], Foo}
```

When a macro is encountered by the compiler, it gets *expanded*. That is, the macro gets evaluated and it's result get's inserted into the place in the AST where the macro call happened. This happens recursively until there is no macro left to expand. During this process, macros can insert variables into the AST, and their nodes will have the macro module as their context.

The context is useful to keep track what code defined which variables. For instance, consider this macro:
```elixir
defmodule A do
  defmacro demo() do
    quote do
      foo
    end
  end
end
```
If we use it in an expression:
```elixir
require A

A.demo()
```
The `A.demo()` call will get expanded to something like:
```elixir
{:foo, [counter: -576460752303422751], A}
```
The variable AST's context is the module of the macro that defined that variable, and additionally a counter number is inserted into the metadata, which prevents the variable from interfering with variables defined outside of the scope of the macro (this is what is meant by "hygienic macros") once it's evaluated.

### Calls

What we saw so far in this section were the *leaf* nodes of the syntax tree. They represent individual pieces of data that can't be reduced any more to produce a meaningful piece of syntax. We still need to combine them to represent a useful program, and this is achieved with *calls*.
Calls are the basic building block with wich other nodes are combined to build a proper AST. In their most basic form, they look like this:
```elixir
sum(1, 2, 3)
```
And they are represented by a 3-tuple:
```elixir
{:sum, [], [1, 2, 3]}
```
Here the first element is the call *type*, the second one is again metadata, and the third one is a list of *arguments*(or *children*). Most of the time the type is an atom but, as we'll see later, there are some special bits of syntax in which the type can be another 3-tuple.



### Operators and constructors
Operators like `+` are also represented as calls:
```elixir
quote do
  1 + 2
end
#=> {:+, [], [1, 2]}
```
The main characteritic of operators is that Elixir can't parse any arbitrary operator. There is a list of supported operators and their associativities in the [Operators](https://hexdocs.pm/elixir/operators.html) section of the Elixir documentation.

Data structures like maps, tuples and bitstrings are represented with a call where the type is the atom name of their respective special form constructor, and the arguments are their elements.
For example, the following map:
```elixir
%{foo: :bar}
```
Is represented by the call:
```elixir
{:%{}, [], [foo, :bar]}
```
The same goes for tuples of sizes other than 2:
```elixir
quote do
  {1, 2, 3}
end
#=> {:{}, [], [1, 2, 3]}
```
or bitstrings:
```elixir
quote do
  <<1, 2, 3>>
end
#=> {:<<>>, [], [1, 2, 3]}
```

### Aliases and blocks

Some types have a special meaning. For example, module names are atoms, but they are represented in the AST by a call with the `:__aliases` type:
```elixir
quote do
  Foo
end
#=> {:__aliases__, [], [:Foo]}
```
The arguments to this call are the segments of a module name:
```elixir
quote do
  Foo.Bar.Baz
end
#=> {:__aliases__, [], [:Foo, :Bar, :Baz]}
```

Another special case is blocks of code. A block is a sequence of two or more "self-contained" expressions, each defined in a different line. It is represented as a `__block__` call, where each line is a separate argument:
```elixir
quote do
  1
  2
  3
end
#=> {:__block__, [], [1, 2, 3]}
```
Elixir also allows you to use a semicolon as a line delimiter, so this expression is equivalent to the previous one:
```elixir
quote do 1; 2; 3; end
#=> {:__block__, [], [1, 2, 3]}
```

### Left to right arrow

The left to right arrow `->` is a special kind of node. It is represented as a call like an operator, but it can only exist in a list, which suggests that it can only be used as an argument for another call, like clauses for an anonymous function or in a `do` block.
The first argument must always be a list representing it's left hand side arguments, and the second one is an expression.

```elixir
quote do
  case 1 do
    2 -> 3
    4 -> 5
  end
end
#=> {:case, [], [1, [do: [{:->, [], [[2], 3]}, {:->, [], [[4], 5]}]]]}

quote do
  cond do
    true -> false
  end
end
#=> {:cond, [], [[do: [{:->, [], [[true], false]}]]]}

quote do
  (1, 2 -> 3
   4, 5 -> 6)
end
#=> [{:->, [], [[1, 2], 3]}, {:->, [], [[4, 5], 6]}]

quote do
  fn
    1, 2 -> 3
    4, 5 -> 6
  end
end
#=> {:fn, [], [{:->, [], [[1, 2], 3]}, {:->, [], [[4, 5], 6]}]}
```
<small>Examples borrowed from the Elixir syntax reference</small>

### Calls as call types

Earlier I mentioned that there are some cases where a call type can be another 3-tuple. This happens when there is a call on the left hand side of the `()` (call) operator. There are two of these situations:

- When the left hand side is another call
- With the `.` operator

The first situation occurs in cases like `foo()()`. Such syntax is invalid in most cases and will fail to compile, but it is possible to use it inside of `quote`, where it is commonly used to compose quoted expressions to generate functions with `unquote`.
Lets look at this example:
```elixir
quote unquote: false do
  unquote(:foo)()
end
#=> {{:unquote, [], [:foo]}, [], []}
```
The `unquote: false` option forces `quote` to interpret `unquote` as a normal call, preventing it from injecting code into our expression, so we can see how it is represented in the AST.
We can see that the type here is the call `{:unquote, [], [:foo]}` instead of an atom.

The second situation is more interesting, and is where things start to get funky. Let's consider the following syntax:
```elixir
foo.bar
```
If we quote it, we get the following AST:
```elixir
{{:., [], [{:foo, [], Elixir}, :bar]}, [no_parens: true], []}
```
There's quite a bit to unpack here.
The type of the node is a dot operator call, where the left hand side is a variable, and the right hand side is an atom:
```elixir
{:., [], [{:foo, [], Elixir}, :bar]}
```
The outer node is a call with no arguments, but it contains the `no_parens: true` metadata. What this suggests is that every use of the `.` operator will be represented as a call where the parenthesis may be omitted, and the type will be a dot operator call.

It's not hard to also prove that the dot operator call can be arbitratily nested:
```elixir
quote do
  foo.bar.baz(1, 2, 3)
end

#=>
{
  {:., [], [
    {:., [], [{:foo, [], Elixir}, :bar]}, :baz
  ]}, [], [1, 2, 3]
}
```

Another case of the dot operator call is the multi alias syntax: `Foo.{Bar, Baz}`. This syntax is most often used when aliasing multiple modules. It's represented in the AST as a `{:., [], [alias, :{}]}` call:
```elixir
quote do
  Foo.{Bar, Baz}
end
#=>
{
  {:., [], [{:__aliases__, [], [:Foo]}, :{}]},
  [],
  [{:__aliases__, [], [:Bar]}, {:__aliases__, [], [:Baz]}]
}
```
The interesting bits here are the arguments to the dot call: the `[alias, :{}]` arguments are the way Elixir uses to recognize multiple aliasing as something different from `Foo.{}(Bar, Baz)`.

There's a last case for the dot operator call, and this one striked me as odd the first time, because it's not obvious at all that we're dealing with a dot operator. Let's look at the following quoted expression:
```elixir
quote do
  foo[:bar]
end
#=> {{:., [], [Access, :get]}, [], [{:foo, [], Elixir}, :bar]}
```
It turns out the access syntax is, under the hood, a dot operator call! The way Elixir recognizes it in the AST is by the `[Access, :get]` arguments for the inner dot call, and it only allows as many arguments as `Access.get`. The reason being that it gets evaluated to a call to that function:
```elixir
Macro.to_string({{:., [], [Access, :get]}, [], [{:foo, [], Elixir}]})
#=> "Access.get(foo)"

Macro.to_string({{:., [], [Access, :get]}, [], [{:foo, [], Elixir}, :bar]})
#=> "foo[:bar]"

Macro.to_string({{:., [], [Access, :get]}, [], [{:foo, [], Elixir}, :bar, :baz]})
#=> "Access.get(foo, :bar, :baz)"

Macro.to_string({{:., [], [Access, :get]}, [], [{:foo, [], Elixir}, :bar, :baz, :qux]})
#=> "Access.get(foo, :bar, :baz, :quz)" <-- this will fail
```

---
That should cover most, if not all, of the possible constructs that conform an Elixir AST. Any kind of AST you find will be made of a composition of the nodes mentioned before, and knowing them makes reading it and identifying patterns much more easier.

While knowing the AST structure is very useful for this kind of work, as the code gets more complex it can be hard to guess to which AST construct a piece of syntax will get parsed to. I will try to approach the following sections by destructuring the AST and looking at smaller pieces of it at a time to reinforce ideas, but what I highly recommend is to open an IEx session and start playing around with `quote`, or using the [AST Ninja](https://ast.ninja/) tool by [Arjan Scherpenisse](https://github.com/arjan/ast_ninja).

In the next section we will put this knowledge to practice by building a macro that analyzes a piece of syntax to generate typespecs for a struct.

# Leveraging the AST to build macros

Now that we know what the AST looks like, we can use it to build something useful. Let's look at the following piece of code:
```elixir
defmodule Report do
  @type report_type :: :refactoring | :warning | :consistency

  @type t :: %__MODULE__{
    type: report_type,
    description: String.t,
    message: String.t | nil
  }
  @enforce_keys [:type, :description]
  defstruct [:description, :message, type: :refactoring]
end
```
This is fairly standard Elixir code for defining a struct, enforcing some of it's keys, and defining an accompanying typespec. It is, however, quite verbose and hard to follow, since we have to make some jumps between the type, the defstruct and the enforce_keys attribute to check what it looks like and if everything is alright.
We can use a macro so simplify it a bit, and make the syntax closer to that of Ecto schemas. The macro we'll be writing will allow us to write the above code like this:
```elixir
defmodule Report do
  @type report_type :: :refactoring | :warning | :consistency

  typedstruct do
    field :type, report_type, required?: true, default: :refactoring
    field :description, String.t, required?: true
    field :message, String.t
  end
end
```
The plan is the following: we will define a `typedstruct` macro, and extract the struct data from the received AST to finally generate the the struct definition, typespec, and enforcing options. There are other ways to achieve this, but they involve the definition of more macros and, while they can improve error reporting and are generally ore easily extensible, they are too complex for the purposes of this exercise.

Let's start by creating the macro:
```elixir
defmodule TypedStruct do
  defmacro typedstruct(ast) do
    # ...
  end
end
```

Now we need to look at the received AST and look for `:field` calls. The intended usage of the macro is in with a `do` block. This syntax is sugar for the case when the last element for a function is a keyword list, and it's last element has the `:do` key.
If we look at this example:
```elixir
typedstruct do
  field :message, String.t
end
```
The argument passed to `typedstruct` will be `[do: ...]`. What comes after the `do` can be a single expression if it's just one line, or a `:__block__` if it's two or more, as we saw earlier. We'll need to consider this when we extract the fields from the AST.
A simple way to do it is to ensure we always have a list of lines:
```elixir
# The macro will always be used with a do block, so we match against that
defmacro typedstruct(do: ast) do
  fields_ast =
    case ast do
      {:__block__, [], fields} -> fields
      field -> [field]
    end
end
```
Now the next step is to get the information out of the field calls. Each line shoul be a field definition like this one:
```elixir
field :description, String.t, enforced?: true
```
As we saw earlier, this would be represented by a call like this:
```elixir
{:field, [], [field_name, typespec, options?]}
```
Since we have a list of the fields AST, we can create a helper function to extract the data we need from them and use `Enum.map` to get a list of fields data back:
```elixir
defmacro typedstruct(do: ast) do
  fields_ast =
    case ast do
      {:__block__, [], fields} -> fields
      field -> [field]
    end

  fields_data = Enum.map(fields_ast, &get_field_data/1)
end

defp get_field_data({:field, [], [name, typespec]}) do
  # In this case the options were not provided,
  # so we set them to the empty list and process
  # it again
  get_field_data({:field, [], [name, typespec, []]})
end
defp get_field_data({:field, [], [name, typespec, opts]}) do
  default = Keyword.get(opts, :default)
  enforced? = Keyword.get(opts, :enforced?, false)

  %{
    name: name,
    typespec: typespec,
    default: default,
    enforced?: enforced?
  }
end
```
Great! Now the next step is to use this data to build the code we wanted to abstract. For this we will use `quote` to create a quoted expression, and `unquote`/`unquote_splicing` to interpolate the data we just obtained.

For the enforced fields list, this one is easiy, we just need the names of the fields where `enforced?` is true:
```elixir
enforced_fields =
  for field <- fields_data, field.enforced? do
    field.name
  end
```

The typespec for a struct would look like this:
```
@type t :: %__MODULE__{
  name: typespec
}
```
If we recall from the AST node types section, the arguments for a map constructor call is a keyword list, just like when we try to enumerate a map with the `Enum` module. If we want to insert our typespecs there, we need to create keyword list entries(`{name, value}` tuples):
```elixir
typespecs =
  Enum.map(fields_data, fn
    %{name: name, typespec: typespec} -> {name, typespec}
  end)
```
There is a catch, though. If the field is not enforced, then the typespec would also need to reflect this with `typespec | nil`, so we need to add an extra clause to our function:
```elixir
typespecs =
  Enum.map(fields_data, fn
    %{name: name, typespec: typespec, enforced?: true} -> {name, typespec}
    %{name: name, typespec: typespec} ->
      {
        name,
        {:|, [], [typespec, nil]}
      }
  end)
```
Here I'm doing the same as in the previous case if the field is enforce, otherwise I build a call to the `|` operator to create the `typespec | nil` syntax.

Finally, for the list of fields and their defaults:
```elixir
fields =
  for %{name: name, default: default} <- fields_data do
    {name, default}
  end
```

Now that we have everything we need, we can generate the code:
```elixir
quote do
  @type t :: %__MODULE__{unquote_splicing(typespecs)}
  @enforce_keys unquote(enforced_fields)
  defstruct unquote(fields)
end
```
And that's it! We now have a macro to easily define typespec-ed structs.

The final code:
```elixir
defmodule TypedStruct do
  defmacro typedstruct(do: ast) do
    fields_ast =
      case ast do
        {:__block__, [], fields} -> fields
        field -> [field]
      end

    fields_data = Enum.map(fields_ast, &get_field_data/1)

    enforced_fields =
      for field <- fields_data, field.enforced? do
        field.name
      end
    
    typespecs =
      Enum.map(fields_data, fn
        %{name: name, typespec: typespec, enforced?: true} -> {name, typespec}
        %{name: name, typespec: typespec} ->
          {
            name,
            {:|, [], [typespec, nil]}
          }
      end)
    
    fields =
      for %{name: name, default: default} <- fields_data do
        {name, default}
      end
    
    quote do
      @type t :: %__MODULE__{unquote_splicing(typespecs)}
      @enforce_keys unquote(enforced_fields)
      defstruct unquote(fields)
    end
  end

  defp get_field_data({:field, [], [name, typespec]}) do
    get_field_data({:field, [], [name, typespec, []]})
  end
  defp get_field_data({:field, [], [name, typespec, opts]}) do
    default = Keyword.get(opts, :default)
    enforced? = Keyword.get(opts, :enforced?, false)

    %{
      name: name,
      typespec: typespec,
      default: default,
      enforced?: enforced?
    }
  end
end
```

# Building a code style checker

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
The `Creed.run/1` function will take a file path, read it's content, and parse them to an Elixir AST with `Code.string_to_quoted/2`. We mentioned earlier that the AST metadata contains information like the line number, and now we will need them to tell the user where the issue was found. By default, the parser won't include the column numbers in the metadata, so we need to pass the `columns: true` option.
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
So we will need to traverse the AST looking for such pattern. Elixir provides a straightforward way to perform traversals through the AST via the `prewalk`, `postwalk` and `traverse` functions from the `Macro` module. These functions perform depth-first traversals, which means it will go as deep as it can into the tree, and then calling your callback function as it backtracks, until it visits all nodes in the tree. The callback function allows you to modify the visited node, and it also lets you pass an accumulator in a similar fashion to `Enum.reduce`. For this code analyzer we will just use `Macro.postwalk` the accumulator to store the issues as we find them.

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

  defp traverse({
    {:., _, [{:__aliases__, _, [:String]}, :to_atom]},
    meta, _args
  } = node, acc) when is_atom(module) do
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
If that pattern matches, then we extract the line and column numbers from the call metadata and build an issue map that gets added to the accumulator(ie: the issues list). If it doesn't match, then it's a node we're not interested in so we do nothing. Notice that we need to return both the node and the accumulator in a tuple, since `postwalk` allows us to modify the AST.

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
Lets remind ourselves what the multi alias syntax looks like as AST:
```
quote do
  Foo.{Bar, Baz}
end
{{:., [], [{:__aliases__, [], [:Foo]}, :{}]}, [],
 [
   {:__aliases__, [], [:Bar]},
   {:__aliases__, [], [:Baz]}
 ]}
```
The important bit here is the `{:., [], [{:__aliases__, [], [:Foo]}, :{}]}` call, since it's what indicates us that we're in a multi alias call.
Additionally, we want to check if that happens in the context of a module alias, like this:
```elixir
alias Foo.{Bar, Baz}
```
This is quite simple to spot, since it's just a regular `{:alias, [], [args]}` call, where args will be the multi alias call.

Now the idea is the same as the previous check: we traverse the AST, and if we match that pattern we build an issue:
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

Let's also modify out testing file and add a multi alias:
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

We have learned quite a bit through this article. The Elixir AST itself is quite simple when you look at it's basic shapes, but it can get quite complex for larger programs. Isolating little bits of syntax makes it much easier to see what's going on and to develop a general sense of what it's representing. We learned most(all?) of the possible shapes an AST node can take and how they are combined to create meaningful programs, and we leveraged this knowledge to create useful tools for our day to day programming work.

I had lots of fun digging into this topic and finding examples to bring all those concepts to a more tangible shape. I hope this was informative and that it helps you to build your own tools and understand other people's AST manipulation code.